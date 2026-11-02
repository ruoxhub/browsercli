/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {globalPageSnapshotManager} from '../../../../src/modules/snapshot/PageSnapshotManager.js';
import {takeSnapshot} from '../../../../src/tools/dom/takeSnapshot.js';

function createMockContext(mockPage: any) {
  return {
    getSelectedPage: () => mockPage,
    getSelectedFrame: () => ({
      page: () => mockPage,
    }),
  };
}

function captureResponse() {
  const lines: string[] = [];
  let structuredContent: any = null;
  return {
    response: {
      appendResponseLine(line: string) {
        lines.push(line);
      },
      setStructuredContent(content: any) {
        structuredContent = content;
      },
    },
    get lines() {
      return lines;
    },
    get structuredContent() {
      return structuredContent;
    },
  };
}

describe('takeSnapshot tool', () => {
  it('captures accessibility tree, returns formatted tree and stores in snapshot manager', async () => {
    const mockPage = {
      accessibility: {
        snapshot: async () => ({
          role: 'RootWebArea',
          name: 'Home',
          children: [
            {role: 'button', name: 'Login'},
            {role: 'textbox', name: 'Search'},
          ],
        }),
      },
    };

    const context = createMockContext(mockPage);
    const output = captureResponse();

    await takeSnapshot.handler(
      {params: {}} as any,
      output.response as any,
      context as any,
    );

    assert.ok(output.structuredContent);
    assert.strictEqual(output.structuredContent.success, true);
    assert.strictEqual(output.structuredContent.nodeCount, 3);
    assert.ok(output.structuredContent.snapshotId);
    assert.ok(output.structuredContent.textOutline.includes('uid='));
    assert.ok(output.structuredContent.textOutline.includes('button "Login"'));
    assert.ok(output.lines.some(l => l.includes('页面快照捕获成功')));

    // Verify stored in snapshot manager
    const snapshot = globalPageSnapshotManager.getSnapshot(mockPage as any);
    assert.ok(snapshot);
    assert.strictEqual(snapshot.nodeCount, 3);
  });

  it('captures vom mode and correctly prunes occluded layers', async () => {
    const mockPage = {
      evaluate: async () => ({
        viewport: {width: 1000, height: 800},
        nodes: [
          {
            id: 1,
            parentId: null,
            tag: 'div',
            role: 'main',
            name: 'Background Page',
            paintOrder: 1,
            position: 'static',
            pointerEvents: 'auto',
            clickable: false,
            rect: {x: 0, y: 0, w: 1000, h: 800},
          },
          {
            id: 2,
            parentId: 1,
            tag: 'button',
            role: 'button',
            name: 'Background Button',
            paintOrder: 2,
            position: 'static',
            pointerEvents: 'auto',
            clickable: true,
            referenceable: true,
            rect: {x: 50, y: 50, w: 100, h: 40},
          },
          {
            id: 3,
            parentId: null,
            tag: 'div',
            role: 'dialog',
            modal: true,
            name: 'Modal Dialog',
            paintOrder: 10,
            position: 'fixed',
            pointerEvents: 'auto',
            clickable: false,
            rect: {x: 0, y: 0, w: 1000, h: 800},
          },
          {
            id: 4,
            parentId: 3,
            tag: 'button',
            role: 'button',
            name: 'Modal Submit',
            paintOrder: 11,
            position: 'static',
            pointerEvents: 'auto',
            clickable: true,
            referenceable: true,
            rect: {x: 200, y: 200, w: 120, h: 40},
          },
        ],
      }),
    };

    const context = createMockContext(mockPage);
    const output = captureResponse();

    await takeSnapshot.handler(
      {params: {mode: 'vom'}} as any,
      output.response as any,
      context as any,
    );

    assert.ok(output.structuredContent);
    assert.strictEqual(output.structuredContent.success, true);
    assert.ok(output.structuredContent.textOutline.includes('Modal Submit'));
    assert.equal(output.structuredContent.textOutline.includes('Background Button'), false);

    const snapshot = globalPageSnapshotManager.getSnapshot(mockPage as any);
    assert.ok(snapshot);
  });

  it('fails with PAGE_REQUIRED when no active page is selected', async () => {
    const context = {
      getSelectedPage: () => null,
      getSelectedFrame: () => null,
    };
    const output = captureResponse();

    await assert.rejects(
      () =>
        takeSnapshot.handler(
          {params: {}} as any,
          output.response as any,
          context as any,
        ),
      {
        message: /当前没有活动的页面/,
      },
    );
  });
});
