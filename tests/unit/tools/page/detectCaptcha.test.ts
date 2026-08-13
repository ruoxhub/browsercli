/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import {zod} from '../../../../src/third_party/index.js';
import {ToolCategory} from '../../../../src/tools/categories.js';
import {GENERATED_TOOL_REGISTRY} from '../../../../src/tools/generated-tools-index.js';
import {detectCaptcha} from '../../../../src/tools/page/detectCaptcha.js';
import * as pageTools from '../../../../src/tools/page/index.js';
import {manifest as pageManifest} from '../../../../src/tools/page/manifest.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

import type {CaptchaPageSnapshot} from '../../../../src/modules/captcha/types.js';
import type {Page} from '../../../../src/third_party/index.js';

interface CaptchaToolPayload {
  success: boolean;
  message: string;
  tooltype: string;
  data?: {
    action: 'detect' | 'wait_for_clear';
    assessment: {
      status: string;
      detected: boolean;
    };
    wait?: {
      cleared: boolean;
      elapsedMs: number;
      checks: number;
    };
  };
}

const EMPTY_SNAPSHOT: CaptchaPageSnapshot = {
  bodyText: '',
  elements: [],
};

const WIDGET_SNAPSHOT: CaptchaPageSnapshot = {
  bodyText: '',
  elements: [
    {
      tagName: 'div',
      id: '',
      className: '',
      role: '',
      ariaLabel: '',
      src: '',
      title: '',
      alt: '',
      visible: true,
      hasSiteKey: true,
      draggable: false,
    },
  ],
};

function pageReturning(
  snapshot: CaptchaPageSnapshot,
  overrides: {
    closed?: boolean;
    title?: () => Promise<string>;
  } = {},
): Page {
  return {
    isClosed: () => overrides.closed ?? false,
    url: () => 'https://example.test/account',
    title: overrides.title ?? (async () => 'Account'),
    evaluate: async () => snapshot,
  } as unknown as Page;
}

function payload(response: ToolResponseAccumulator): CaptchaToolPayload {
  return response.toJSON().structuredContent as CaptchaToolPayload;
}

async function runTool(
  params: {action?: 'detect' | 'wait_for_clear'; timeout?: number},
  page: Page | null,
): Promise<CaptchaToolPayload> {
  const response = new ToolResponseAccumulator();
  const context = {
    getSelectedPage: () => page,
  } as Parameters<typeof detectCaptcha.handler>[2];
  const parsed = zod.object(detectCaptcha.schema).parse(params);
  await detectCaptcha.handler({params: parsed}, response, context);
  return payload(response);
}

describe('detect_captcha schema and registration', () => {
  it('declares a read-only Pages tool with bounded input', () => {
    assert.equal(detectCaptcha.name, 'detect_captcha');
    assert.deepEqual(detectCaptcha.annotations, {
      category: ToolCategory.PAGES,
      readOnlyHint: true,
    });

    const schema = zod.object(detectCaptcha.schema);
    assert.deepEqual(schema.parse({}), {action: 'detect'});
    assert.deepEqual(schema.parse({action: 'wait_for_clear'}), {
      action: 'wait_for_clear',
    });
    for (const timeout of [999, 300001, 1000.5]) {
      assert.equal(
        schema.safeParse({action: 'wait_for_clear', timeout}).success,
        false,
      );
    }
    assert.equal(
      schema.safeParse({action: 'wait_for_clear', timeout: 300000}).success,
      true,
    );
  });

  it('is exported and registered exactly once', () => {
    assert.equal(pageTools.detectCaptcha, detectCaptcha);
    assert.equal(
      pageManifest.tools.filter(entry => entry.handlerName === 'detectCaptcha')
        .length,
      1,
    );
    assert.equal(
      GENERATED_TOOL_REGISTRY.filter(
        entry => entry.handlerName === 'detectCaptcha',
      ).length,
      1,
    );
  });
});

describe('detect_captcha handler', () => {
  it('fails clearly when no page is selected', async () => {
    const result = await runTool({}, null);

    assert.equal(result.success, false);
    assert.equal(result.tooltype, 'detect_captcha');
    assert.match(result.message, /select_page/);
  });

  it('defaults to detect and treats a detected challenge as success', async () => {
    const result = await runTool({}, pageReturning(WIDGET_SNAPSHOT));

    assert.equal(result.success, true);
    assert.equal(result.data?.action, 'detect');
    assert.equal(result.data?.assessment.status, 'detected');
    assert.equal(result.data?.assessment.detected, true);
    assert.equal(result.data?.wait, undefined);
  });

  it('returns an immediate successful wait result for an initially clear page', async () => {
    const result = await runTool(
      {action: 'wait_for_clear', timeout: 1000},
      pageReturning(EMPTY_SNAPSHOT),
    );

    assert.equal(result.success, true);
    assert.equal(result.data?.action, 'wait_for_clear');
    assert.equal(result.data?.wait?.cleared, true);
    assert.equal(result.data?.wait?.checks, 1);
    assert.equal(result.data?.assessment.status, 'not_detected');
  });

  it('keeps wait timeout as a successful domain result', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const pending = runTool(
        {action: 'wait_for_clear', timeout: 5000},
        pageReturning(WIDGET_SNAPSHOT),
      );

      await clock.tickAsync(0);
      await clock.tickAsync(5000);
      const result = await pending;

      assert.equal(result.success, true);
      assert.equal(result.data?.wait?.cleared, false);
      assert.equal(result.data?.wait?.elapsedMs, 5000);
      assert.equal(result.data?.wait?.checks, 3);
      assert.equal(result.data?.assessment.status, 'detected');
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('ignores detect-only timeout and sanitizes unexpected page errors', async () => {
    const detectWithWaitTimeout = await runTool(
      {action: 'detect', timeout: 1000},
      pageReturning(EMPTY_SNAPSHOT),
    );
    assert.equal(detectWithWaitTimeout.success, true);
    assert.equal(detectWithWaitTimeout.data?.action, 'detect');
    assert.equal(detectWithWaitTimeout.data?.assessment.status, 'not_detected');

    const secret = 'private-page-body-secret';
    const failed = await runTool(
      {},
      pageReturning(EMPTY_SNAPSHOT, {
        title: async () => {
          throw new Error(secret);
        },
      }),
    );
    assert.equal(failed.success, false);
    assert.match(failed.message, /无法读取当前页面/);
    assert.doesNotMatch(failed.message, new RegExp(secret));
  });

  it('normalizes closed-page failures without exposing raw details', async () => {
    const result = await runTool(
      {},
      pageReturning(EMPTY_SNAPSHOT, {closed: true}),
    );

    assert.equal(result.success, false);
    assert.match(result.message, /已关闭/);
    assert.doesNotMatch(result.message, /Target page/);
  });

  it('maps connection, navigation, and assessment-timeout failures safely', async () => {
    const cases = [
      {
        raw: 'fetch failed private-detail',
        expected: /浏览器连接失败/,
      },
      {
        raw: 'Execution context was destroyed private-detail',
        expected: /执行上下文已销毁/,
      },
    ];
    for (const sample of cases) {
      const result = await runTool(
        {},
        pageReturning(EMPTY_SNAPSHOT, {
          title: async () => {
            throw new Error(sample.raw);
          },
        }),
      );
      assert.equal(result.success, false);
      assert.match(result.message, sample.expected);
      assert.doesNotMatch(result.message, /private-detail/);
    }

    const clock = sinon.useFakeTimers();
    try {
      const pending = runTool(
        {},
        pageReturning(EMPTY_SNAPSHOT, {
          title: () => new Promise<string>(() => undefined),
        }),
      );
      await clock.tickAsync(0);
      await clock.tickAsync(5000);
      const timedOut = await pending;
      assert.equal(timedOut.success, false);
      assert.match(timedOut.message, /评估超时/);
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });
});
++ b/tests/unit/tools/page/detectCaptcha.test.ts
