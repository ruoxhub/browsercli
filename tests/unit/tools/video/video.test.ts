/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {video} from '../../../../src/tools/video/video.js';

function captureResponse() {
  let structuredContent: any;
  let text = '';
  return {
    response: {
      setStructuredContent(val: any) {
        structuredContent = val;
      },
      appendResponseLine(line: string) {
        text += line + '\n';
      },
    },
    get structuredContent() {
      return structuredContent;
    },
    get text() {
      return text;
    },
  };
}

describe('Video MCP Tool', () => {
  it('handles capabilities action', async () => {
    const output = captureResponse();
    await video.handler(
      {params: {action: 'capabilities'}} as any,
      output.response as any,
      {} as any,
    );

    assert.ok(output.structuredContent);
    assert.equal(output.structuredContent.format, 'mp4');
    assert.equal(output.structuredContent.audio, false);
    assert.equal(output.structuredContent.version, 1);
  });

  it('handles list action', async () => {
    const output = captureResponse();
    await video.handler(
      {params: {action: 'list'}} as any,
      output.response as any,
      {} as any,
    );

    assert.ok(output.structuredContent);
    assert.ok(Array.isArray(output.structuredContent.recordings));
  });

  it('handles business errors returning structured error object', async () => {
    const output = captureResponse();
    await video.handler(
      {params: {action: 'status', recording_id: 'invalid-id'}} as any,
      output.response as any,
      {} as any,
    );

    assert.ok(output.structuredContent?.error);
    assert.equal(output.structuredContent.error.code, 'invalid_params');
  });
});
