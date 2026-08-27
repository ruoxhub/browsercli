/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {SessionRow} from '../../../../src/modules/session/types.js';
import {getRuntime} from '../../../../src/runtime.js';
import {ToolCategory} from '../../../../src/tools/categories.js';
import {sessionCreate} from '../../../../src/tools/session/session_create.js';
import {sessionList} from '../../../../src/tools/session/session_list.js';

interface CapturedContent {
  tooltype?: string;
  session?: SessionRow;
  sessions?: SessionRow[];
}

function responseCapture(): {
  response: {
    setStructuredContent: (content: unknown) => void;
    appendResponseLine: (line: string) => void;
  };
  getStructuredContent: () => CapturedContent | null;
} {
  let structuredContent: CapturedContent | null = null;
  const lines: string[] = [];
  return {
    response: {
      setStructuredContent: (c: unknown) => {
        structuredContent = c as CapturedContent;
      },
      appendResponseLine: (line: string) => {
        lines.push(line);
      },
    },
    getStructuredContent: () => structuredContent,
  };
}

describe('session tools', () => {
  it('exposes expected tool names and categories', () => {
    assert.strictEqual(sessionCreate.name, 'session_create');
    assert.strictEqual(
      sessionCreate.annotations?.category,
      ToolCategory.NETWORK,
    );

    assert.strictEqual(sessionList.name, 'session_list');
    assert.strictEqual(sessionList.annotations?.category, ToolCategory.NETWORK);
    assert.strictEqual(sessionList.annotations?.readOnlyHint, true);
  });

  it('session_create activates session with status capturing', async () => {
    const capture = responseCapture();
    const sessionName = `test-session-${Date.now()}`;
    await sessionCreate.handler(
      {
        params: {
          name: sessionName,
          targetUrl: 'https://example.com/test',
        },
      },
      capture.response as never,
      {} as never,
    );

    const content = capture.getStructuredContent();
    assert.ok(content, 'structured content should be set');
    assert.strictEqual(content.tooltype, 'session_create');
    assert.ok(content.session, 'session object should be returned');
    assert.strictEqual(content.session.name, sessionName);
    assert.strictEqual(content.session.targetUrl, 'https://example.com/test');
    assert.strictEqual(content.session.status, 'capturing');

    const activeSession = getRuntime().captureSessionManager.getActiveSession();
    assert.ok(activeSession, 'an active session should be set');
    assert.strictEqual(activeSession?.id, content.session.id);
    assert.strictEqual(activeSession?.status, 'capturing');
  });

  it('session_list returns all sessions including created session', async () => {
    const createCapture = responseCapture();
    const sessionName = `list-test-session-${Date.now()}`;
    await sessionCreate.handler(
      {
        params: {
          name: sessionName,
        },
      },
      createCapture.response as never,
      {} as never,
    );
    const createdSession = createCapture.getStructuredContent()?.session;
    assert.ok(createdSession, 'createdSession should exist');

    const listCapture = responseCapture();
    await sessionList.handler(
      {params: {}},
      listCapture.response as never,
      {} as never,
    );

    const listContent = listCapture.getStructuredContent();
    assert.ok(listContent, 'structured content should be set');
    assert.strictEqual(listContent.tooltype, 'session_list');
    assert.ok(
      Array.isArray(listContent.sessions),
      'sessions should be an array',
    );
    assert.ok(
      listContent.sessions.some((s: SessionRow) => s.id === createdSession.id),
      'created session should be present in session_list output',
    );
  });
});
