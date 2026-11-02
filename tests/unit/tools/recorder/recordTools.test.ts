/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {globalInteractionRecorder} from '../../../../src/modules/recorder/InteractionRecorder.js';
import {
  recordStart,
  recordStop,
} from '../../../../src/tools/recorder/recordTools.js';

function createMockContext(mockPage: unknown) {
  return {
    getSelectedPage: () => mockPage,
  };
}

function captureResponse() {
  const lines: string[] = [];
  let structuredContent: Record<string, unknown> | null = null;
  return {
    response: {
      appendResponseLine(line: string) {
        lines.push(line);
      },
      setStructuredContent(content: Record<string, unknown>) {
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

test('recordStart and recordStop cycle captures evidence correctly', async () => {
  let exposedFn: ((payload: unknown) => Promise<void>) | null = null;

  const mockPage = {
    exposeFunction: async (
      _name: string,
      fn: (payload: unknown) => Promise<void>,
    ) => {
      exposedFn = fn;
    },
    evaluate: async (_fn: unknown) => {
      // noop
    },
  };

  const context = createMockContext(mockPage);

  // 1. Start recording
  const startOut = captureResponse();
  await recordStart.handler(
    {params: {}},
    startOut.response as any,
    context as any,
  );

  assert.equal(startOut.structuredContent?.success, true);
  const recId = startOut.structuredContent?.recordingId;
  assert.ok(recId);
  assert.equal(globalInteractionRecorder.isActive(), true);

  // 2. Simulate page event calling exposed bridge
  assert.ok(exposedFn);
  await (exposedFn as (payload: unknown) => Promise<void>)({
    id: 'step_1',
    type: 'click',
    target: {tagName: 'button', name: 'Submit'},
    timestamp: Date.now(),
  });

  // 3. Stop recording
  const stopOut = captureResponse();
  await recordStop.handler(
    {params: {}},
    stopOut.response as any,
    context as any,
  );

  assert.equal(stopOut.structuredContent?.success, true);
  const evidence = stopOut.structuredContent?.evidence as any;
  assert.ok(evidence);
  assert.equal(evidence.recordingId, recId);
  assert.equal(evidence.interactions.length, 1);
  assert.equal(evidence.interactions[0].target.name, 'Submit');
  assert.equal(globalInteractionRecorder.isActive(), false);
});
