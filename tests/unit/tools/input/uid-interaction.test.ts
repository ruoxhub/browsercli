/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {globalPageSnapshotManager} from '../../../../src/modules/snapshot/PageSnapshotManager.js';
import {click} from '../../../../src/tools/input/click.js';
import {fill} from '../../../../src/tools/input/fill.js';
import {hover} from '../../../../src/tools/input/hover.js';

function createMockPageAndFrame() {
  const actions: Array<{action: string; target: string; value?: unknown}> = [];

  const mockLocator = (targetName: string) => ({
    click: async (opts?: unknown) => {
      actions.push({action: 'click', target: targetName, value: opts});
    },
    fill: async (val: string) => {
      actions.push({action: 'fill', target: targetName, value: val});
    },
    hover: async () => {
      actions.push({action: 'hover', target: targetName});
    },
    elementHandle: async () => ({
      evaluate: async (_fn: any) => {
        // Mock isSelect check
        return false;
      },
    }),
  });

  const mockPage = {
    accessibility: {
      snapshot: async () => ({
        role: 'RootWebArea',
        name: 'App',
        children: [
          {role: 'button', name: 'Submit'},
          {role: 'textbox', name: 'Email'},
        ],
      }),
    },
    getByRole: (role: string, opts?: {name?: string}) =>
      mockLocator(`role=${role},name=${opts?.name}`),
    getByText: (text: string) => mockLocator(`text=${text}`),
    locator: (selector: string) => mockLocator(`selector=${selector}`),
  };

  const mockFrame = {
    locator: (selector: string) => mockLocator(`selector=${selector}`),
    page: () => mockPage,
  };

  const mockContext = {
    getSelectedPage: () => mockPage,
    getSelectedFrame: () => mockFrame,
  };

  return {mockPage, mockFrame, mockContext, actions};
}

function captureResponse() {
  let content: any = null;
  const lines: string[] = [];
  return {
    response: {
      setStructuredContent(val: any) {
        content = val;
      },
      appendResponseLine(line: string) {
        lines.push(line);
      },
    },
    get content() {
      return content;
    },
    get lines() {
      return lines;
    },
  };
}

describe('UID interaction dual-mode (click, fill, hover)', () => {
  it('click works with uid after take_snapshot', async () => {
    const {mockPage, mockContext, actions} = createMockPageAndFrame();
    const snapshot = await globalPageSnapshotManager.capture(mockPage as any);
    const buttonUid = Array.from(snapshot.idToNode.entries()).find(
      ([_, n]) => n.role === 'button',
    )?.[0];
    assert.ok(buttonUid);

    const output = captureResponse();
    await click.handler(
      {params: {uid: buttonUid}} as any,
      output.response as any,
      mockContext as any,
    );

    assert.strictEqual(output.content?.success, true);
    assert.ok(actions.some(a => a.action === 'click'));
  });

  it('click works with traditional selector without uid', async () => {
    const {mockContext, actions} = createMockPageAndFrame();
    const output = captureResponse();

    await click.handler(
      {params: {selector: '#submit-btn'}} as any,
      output.response as any,
      mockContext as any,
    );

    assert.strictEqual(output.content?.success, true);
    assert.ok(
      actions.some(
        a => a.action === 'click' && a.target === 'selector=#submit-btn',
      ),
    );
  });

  it('click throws validation error when neither uid nor selector is provided', async () => {
    const {mockContext} = createMockPageAndFrame();
    const output = captureResponse();

    await assert.rejects(
      () =>
        click.handler(
          {params: {}} as any,
          output.response as any,
          mockContext as any,
        ),
      {
        message: /uid 与 selector 至少需要提供一项/,
      },
    );
  });

  it('fill works with uid', async () => {
    const {mockPage, mockContext, actions} = createMockPageAndFrame();
    const snapshot = await globalPageSnapshotManager.capture(mockPage as any);
    const inputUid = Array.from(snapshot.idToNode.entries()).find(
      ([_, n]) => n.role === 'textbox',
    )?.[0];
    assert.ok(inputUid);

    const output = captureResponse();
    await fill.handler(
      {params: {uid: inputUid, value: 'test@example.com'}} as any,
      output.response as any,
      mockContext as any,
    );

    assert.strictEqual(output.content?.success, true);
    assert.ok(
      actions.some(a => a.action === 'fill' && a.value === 'test@example.com'),
    );
  });

  it('hover works with uid', async () => {
    const {mockPage, mockContext, actions} = createMockPageAndFrame();
    const snapshot = await globalPageSnapshotManager.capture(mockPage as any);
    const buttonUid = Array.from(snapshot.idToNode.entries()).find(
      ([_, n]) => n.role === 'button',
    )?.[0];
    assert.ok(buttonUid);

    const output = captureResponse();
    await hover.handler(
      {params: {uid: buttonUid}} as any,
      output.response as any,
      mockContext as any,
    );

    assert.strictEqual(output.content?.success, true);
    assert.ok(actions.some(a => a.action === 'hover'));
  });
});
