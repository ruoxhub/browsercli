/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {ToolCallContextGuard} from '../../../src/worker/ToolCallContextGuard.js';

test('injects _tabContext into structured object responses for context-sensitive tools', () => {
  const guard = new ToolCallContextGuard(() => ({
    getContextMeta: () => ({
      url: 'https://example.test/app',
      title: 'Example App',
      tabIndex: 0,
      pageId: 'page-1',
    }),
  }));

  guard.recordCall('page_navigate');
  const result = guard.enrichResponse('page_navigate', {
    structuredContent: {ok: true},
  });

  assert.deepEqual(result, {
    structuredContent: {
      ok: true,
      _tabContext: {
        url: 'https://example.test/app',
        title: 'Example App',
        tabIndex: 0,
        pageId: 'page-1',
      },
    },
  });
});

test('adds repeatWarning after three consecutive identical calls', () => {
  const guard = new ToolCallContextGuard(() => null);

  guard.recordCall('hookCookie');
  guard.recordCall('hookCookie');
  guard.recordCall('hookCookie');

  const result = guard.enrichResponse('hookCookie', {
    structuredContent: {ok: true} as Record<string, unknown>,
  });

  assert.equal(typeof result.structuredContent.repeatWarning, 'string');
});

test('does not warn for consecutive evaluate_script calls', () => {
  const guard = new ToolCallContextGuard(() => null);

  guard.recordCall('evaluate_script');
  guard.recordCall('evaluate_script');
  guard.recordCall('evaluate_script');
  guard.recordCall('evaluate_script');

  const result = guard.enrichResponse('evaluate_script', {
    structuredContent: {ok: true} as Record<string, unknown>,
  });

  assert.equal(result.structuredContent.repeatWarning, undefined);
});

test('does not mutate non-context-sensitive tools without repeat loops', () => {
  const guard = new ToolCallContextGuard(() => {
    throw new Error('provider should not be called');
  });

  guard.recordCall('understandCode');
  const response = {structuredContent: {ok: true}};

  assert.equal(guard.enrichResponse('understandCode', response), response);
});
