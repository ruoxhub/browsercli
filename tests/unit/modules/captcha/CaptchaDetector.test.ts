/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import {CaptchaDetector} from '../../../../src/modules/captcha/CaptchaDetector.js';

import type {
  CaptchaPageSnapshot,
  CaptchaStatus,
} from '../../../../src/modules/captcha/types.js';
import type {Page} from '../../../../src/third_party/index.js';

interface FakeStyle {
  display: string;
  visibility: string;
  opacity: string;
}

interface FakeElementOptions {
  tagName?: string;
  attributes?: Record<string, string>;
  connected?: boolean;
  rect?: {width: number; height: number};
  style?: Partial<FakeStyle>;
  draggable?: boolean;
  siteKeyValue?: string;
  throwOnValueRead?: boolean;
}

const EMPTY_SNAPSHOT: CaptchaPageSnapshot = {
  bodyText: '',
  elements: [],
};

const styles = new WeakMap<object, FakeStyle>();

function fakeElement(options: FakeElementOptions = {}): Element {
  const attributes = options.attributes ?? {};
  const element = {
    tagName: options.tagName ?? 'DIV',
    isConnected: options.connected ?? true,
    draggable: options.draggable ?? false,
    hasAttribute: (name: string) =>
      name === 'data-sitekey'
        ? options.siteKeyValue !== undefined
        : Object.hasOwn(attributes, name),
    getAttribute: (name: string) => {
      if (name === 'data-sitekey' && options.siteKeyValue !== undefined) {
        throw new Error('data-sitekey value must never be read');
      }
      return attributes[name] ?? null;
    },
    getBoundingClientRect: () => options.rect ?? {width: 100, height: 40},
  };
  if (options.throwOnValueRead) {
    Object.defineProperty(element, 'value', {
      get: () => {
        throw new Error('input value must never be read');
      },
    });
  }
  styles.set(element, {
    display: options.style?.display ?? 'block',
    visibility: options.style?.visibility ?? 'visible',
    opacity: options.style?.opacity ?? '1',
  });
  return element as unknown as Element;
}

function runInFakeDom<T>(
  pageFunction: (arg: unknown) => T,
  arg: unknown,
  bodyText: string | null,
  elements: Element[],
): T {
  const documentDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: bodyText === null ? null : {innerText: bodyText},
      querySelectorAll: () => elements,
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      getComputedStyle: (element: object) => styles.get(element),
    },
  });
  try {
    return pageFunction(arg);
  } finally {
    if (documentDescriptor) {
      Object.defineProperty(globalThis, 'document', documentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}

function pageReturning(
  snapshot: CaptchaPageSnapshot,
  overrides: {
    closed?: boolean;
    url?: () => string;
    title?: () => Promise<string>;
    evaluate?: Page['evaluate'];
  } = {},
): Page {
  return {
    isClosed: () => overrides.closed ?? false,
    url: overrides.url ?? (() => 'https://example.test/account'),
    title: overrides.title ?? (async () => 'Account'),
    evaluate:
      overrides.evaluate ??
      ((async () => snapshot) as unknown as Page['evaluate']),
  } as unknown as Page;
}

describe('CaptchaDetector.assess', {concurrency: false}, () => {
  it('collects one bounded, privacy-safe, product-neutral snapshot', async () => {
    const secret = 'private-site-key';
    const candidates = Array.from({length: 33}, (_, index) =>
      fakeElement({
        tagName: index === 0 ? 'DIV' : index === 8 ? 'IFRAME' : 'INPUT',
        attributes: {
          id: index === 8 ? 'private-iframe-id' : 'i'.repeat(300),
          class:
            index === 0
              ? 'human-challenge'
              : index === 8
                ? 'private-iframe-class'
                : 'volume-range',
          role: index === 0 ? '' : index === 8 ? 'private-role' : 'slider',
          src:
            index === 8
              ? 'https://example.test/human-challenge'
              : 's'.repeat(3000),
          title: index === 0 || index === 8 ? 'human challenge' : '',
          'aria-label': index === 8 ? 'private iframe label' : '',
          alt: index === 8 ? 'private iframe alt' : '',
        },
        siteKeyValue: index === 0 ? secret : undefined,
        throwOnValueRead: true,
        connected: index === 5 ? false : undefined,
        rect:
          index === 6
            ? {width: 0, height: 40}
            : index === 7
              ? {width: 100, height: 0}
              : undefined,
        style:
          index === 1
            ? {display: 'none'}
            : index === 2
              ? {visibility: 'hidden'}
              : index === 3
                ? {visibility: 'collapse'}
                : index === 4
                  ? {opacity: '0'}
                  : undefined,
      }),
    );
    let evaluateCalls = 0;
    let selector = '';
    let captured: CaptchaPageSnapshot | undefined;
    const evaluate = (async (
      pageFunction: (arg: unknown) => CaptchaPageSnapshot,
      arg: {candidateSelector: string},
    ) => {
      evaluateCalls++;
      selector = arg.candidateSelector;
      captured = runInFakeDom(
        pageFunction,
        arg,
        '拖动滑块完成验证 ' + 'x'.repeat(5000),
        candidates,
      );
      return captured;
    }) as unknown as Page['evaluate'];

    const result = await new CaptchaDetector().assess(
      pageReturning(EMPTY_SNAPSHOT, {evaluate}),
    );

    assert.equal(evaluateCalls, 1);
    assert.equal(captured?.bodyText.length, 4000);
    assert.equal(captured?.elements.length, 32);
    assert.equal(captured?.elements[0]?.id.length, 256);
    assert.equal(captured?.elements[0]?.src.length, 2048);
    assert.equal(captured?.elements[0]?.hasSiteKey, true);
    assert.deepEqual(
      captured?.elements.slice(1, 8).map(element => element.visible),
      [false, false, false, false, false, false, false],
    );
    assert.deepEqual(captured?.elements[8], {
      tagName: 'iframe',
      id: '',
      className: '',
      role: '',
      ariaLabel: '',
      src: 'https://example.test/human-challenge',
      title: 'human challenge',
      alt: '',
      visible: true,
      hasSiteKey: false,
      draggable: false,
    });
    assert.match(selector, /data-sitekey/);
    assert.match(selector, /role="slider"/);
    assert.doesNotMatch(
      selector,
      /recaptcha|hcaptcha|turnstile|geetest|cloudflare/i,
    );
    assert.equal(result.status, 'detected');
    assert.equal(result.kind, 'widget');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  });

  it('rejects closed pages and critical read failures', async () => {
    const detector = new CaptchaDetector();
    await assert.rejects(
      detector.assess(pageReturning(EMPTY_SNAPSHOT, {closed: true})),
      /closed/i,
    );
    await assert.rejects(
      detector.assess(
        pageReturning(EMPTY_SNAPSHOT, {
          title: async () => {
            throw new Error('title unavailable');
          },
        }),
      ),
      /title unavailable/,
    );
    await assert.rejects(
      detector.assess(
        pageReturning(EMPTY_SNAPSHOT, {
          url: () => {
            throw new Error('url unavailable');
          },
        }),
      ),
      /url unavailable/,
    );
    await assert.rejects(
      detector.assess(
        pageReturning(EMPTY_SNAPSHOT, {
          evaluate: (async () => {
            throw new Error('dom unavailable');
          }) as Page['evaluate'],
        }),
      ),
      /dom unavailable/,
    );
  });

  it('treats a missing document body as empty visible text', async () => {
    const evaluate = (async (
      pageFunction: (arg: unknown) => CaptchaPageSnapshot,
      arg: unknown,
    ) =>
      runInFakeDom(pageFunction, arg, null, [])) as unknown as Page['evaluate'];

    const result = await new CaptchaDetector().assess(
      pageReturning(EMPTY_SNAPSHOT, {evaluate}),
    );

    assert.equal(result.status, 'not_detected');
    assert.equal(result.evidence.length, 0);
  });

  it('enforces one shared five-second deadline and clears its timer', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const never = new Promise<string>(() => undefined);
      const pending = assert.rejects(
        new CaptchaDetector().assess(
          pageReturning(EMPTY_SNAPSHOT, {title: () => never}),
        ),
        /CAPTCHA assessment timed out after 5000ms/,
      );

      await clock.tickAsync(0);
      await clock.tickAsync(5000);
      await pending;
      assert.ok(clock.countTimers() <= 1);
    } finally {
      clock.restore();
    }
  });
});
type SequenceOutcome = CaptchaStatus | Error;

const STRONG_WIDGET_SNAPSHOT: CaptchaPageSnapshot = {
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

function sequencedPage(outcomes: readonly SequenceOutcome[]): {
  page: Page;
  calls: () => number;
} {
  let calls = 0;
  let current: SequenceOutcome | undefined;
  const page = {
    isClosed: () => false,
    url: () => 'https://example.test/account',
    title: async () => {
      current = outcomes[Math.min(calls++, outcomes.length - 1)];
      if (!current) throw new Error('test sequence must not be empty');
      if (current instanceof Error) throw current;
      return current === 'suspected'
        ? 'Human verification required'
        : 'Account';
    },
    evaluate: async () =>
      current === 'detected' ? STRONG_WIDGET_SNAPSHOT : EMPTY_SNAPSHOT,
  } as unknown as Page;
  return {page, calls: () => calls};
}

const TRANSIENT_ERROR = new Error(
  'Execution context was destroyed by navigation',
);

describe('CaptchaDetector.waitForClear', {concurrency: false}, () => {
  it('returns immediately when the initial assessment is clear', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage(['not_detected']);
      const result = await new CaptchaDetector().waitForClear(sequence.page);

      assert.equal(result.cleared, true);
      assert.equal(result.elapsedMs, 0);
      assert.equal(result.checks, 1);
      assert.equal(sequence.calls(), 1);
      assert.ok(clock.countTimers() <= 1);
    } finally {
      clock.restore();
    }
  });

  it('requires two consecutive clear assessments after a challenge', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage([
        'detected',
        'not_detected',
        'not_detected',
      ]);
      const pending = new CaptchaDetector().waitForClear(sequence.page, 10000);

      await clock.tickAsync(0);
      await clock.tickAsync(4000);
      const result = await pending;

      assert.equal(result.cleared, true);
      assert.equal(result.elapsedMs, 4000);
      assert.equal(result.checks, 3);
      assert.ok(clock.countTimers() <= 1);
    } finally {
      clock.restore();
    }
  });

  it('resets the clear streak for suspected and detected results', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage([
        'detected',
        'not_detected',
        'suspected',
        'not_detected',
        'detected',
        'not_detected',
        'not_detected',
      ]);
      const pending = new CaptchaDetector().waitForClear(sequence.page, 15000);

      await clock.tickAsync(0);
      await clock.tickAsync(12000);
      const result = await pending;

      assert.equal(result.cleared, true);
      assert.equal(result.checks, 7);
      assert.equal(result.elapsedMs, 12000);
      assert.ok(clock.countTimers() <= 1);
    } finally {
      clock.restore();
    }
  });

  it('returns the last successful assessment when the budget expires', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage(['detected', 'suspected']);
      const pending = new CaptchaDetector().waitForClear(sequence.page, 5000);

      await clock.tickAsync(0);
      await clock.tickAsync(5000);
      const result = await pending;

      assert.equal(result.cleared, false);
      assert.equal(result.elapsedMs, 5000);
      assert.equal(result.checks, 3);
      assert.equal(result.assessment.status, 'suspected');
      assert.ok(clock.countTimers() <= 1);
    } finally {
      clock.restore();
    }
  });

  it('retries three transient errors and resets that count after success', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage([
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        'detected',
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        'not_detected',
        'not_detected',
      ]);
      const pending = new CaptchaDetector().waitForClear(sequence.page, 20000);

      await clock.tickAsync(0);
      await clock.tickAsync(16000);
      const result = await pending;

      assert.equal(result.cleared, true);
      assert.equal(result.checks, 9);
      assert.equal(sequence.calls(), 9);
      assert.ok(clock.countTimers() <= 1);
    } finally {
      clock.restore();
    }
  });

  it('fails on the fourth transient error and on non-transient errors', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const transientSequence = sequencedPage([
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
      ]);
      const transientFailure = assert.rejects(
        new CaptchaDetector().waitForClear(transientSequence.page, 20000),
        /Execution context was destroyed/,
      );
      await clock.tickAsync(0);
      await clock.tickAsync(6000);
      await transientFailure;
      assert.equal(transientSequence.calls(), 4);
      assert.ok(clock.countTimers() <= 1);

      const fatalSequence = sequencedPage([new Error('permission denied')]);
      await assert.rejects(
        new CaptchaDetector().waitForClear(fatalSequence.page),
        /permission denied/,
      );
      assert.ok(clock.countTimers() <= 1);
    } finally {
      clock.restore();
    }
  });

  it('fails if the page closes or the budget has no successful assessment', async () => {
    await assert.rejects(
      new CaptchaDetector().waitForClear(
        pageReturning(EMPTY_SNAPSHOT, {closed: true}),
      ),
      /closed/i,
    );

    const clock = sinon.useFakeTimers();
    try {
      const sequence = sequencedPage([
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
        TRANSIENT_ERROR,
      ]);
      const pending = assert.rejects(
        new CaptchaDetector().waitForClear(sequence.page, 5000),
        /before a successful assessment/,
      );
      await clock.tickAsync(0);
      await clock.tickAsync(5000);
      await pending;
      assert.equal(sequence.calls(), 3);
      assert.equal(clock.countTimers(), 0);
    } finally {
      clock.restore();
    }
  });

  it('rejects non-positive, fractional, and non-finite module timeouts', async () => {
    const page = sequencedPage(['not_detected']).page;
    for (const timeout of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        new CaptchaDetector().waitForClear(page, timeout),
        RangeError,
      );
    }
  });
});
