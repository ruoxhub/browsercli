/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {selectExecutionContext} from '../../../../src/tools/debugger/contextSelector.js';
import type {ExecutionContextInfo} from '../../../../src/tools/debugger/executionContexts.js';

function ctx(
  id: number,
  world: 'page' | 'content-script' | 'unknown',
  frameId?: string,
  extensionId?: string,
): ExecutionContextInfo {
  return {
    id,
    frameId,
    origin: '',
    name: `ctx-${id}`,
    world,
    extensionId,
  };
}

describe('selectExecutionContext', () => {
  it('空候选返回 null', () => {
    assert.equal(selectExecutionContext([]), null);
    assert.equal(selectExecutionContext([], {context: 'content-script'}), null);
  });

  it('单个 page 候选直接命中', () => {
    const contexts = [ctx(1, 'page', 'frame-main')];
    const selected = selectExecutionContext(contexts, {context: 'page'});
    assert.ok(selected);
    assert.equal(selected?.id, 1);
  });

  it('多个 page 候选、未传 frameId、未开 fallback → null', () => {
    const contexts = [
      ctx(1, 'page', 'frame-main'),
      ctx(2, 'page', 'frame-iframe'),
    ];
    assert.equal(selectExecutionContext(contexts, {context: 'page'}), null);
  });

  it('多个 page 候选、未传 frameId、开启 fallback → 第一个', () => {
    const contexts = [
      ctx(1, 'page', 'frame-main'),
      ctx(2, 'page', 'frame-iframe'),
    ];
    const selected = selectExecutionContext(contexts, {
      context: 'page',
      fallbackToFirst: true,
    });
    assert.equal(selected?.id, 1);
  });

  it('显式 frameId 精确命中', () => {
    const contexts = [
      ctx(1, 'page', 'frame-main'),
      ctx(2, 'page', 'frame-iframe'),
    ];
    const selected = selectExecutionContext(contexts, {
      context: 'page',
      frameId: 'frame-iframe',
    });
    assert.equal(selected?.id, 2);
  });

  it('显式 frameId 不匹配 + fallback=false → null', () => {
    const contexts = [ctx(1, 'page', 'frame-main')];
    assert.equal(
      selectExecutionContext(contexts, {
        context: 'page',
        frameId: 'does-not-exist',
      }),
      null,
    );
  });

  it('extensionId 过滤 content-script', () => {
    const contexts = [
      ctx(1, 'content-script', 'frame-main', 'ext-A'),
      ctx(2, 'content-script', 'frame-main', 'ext-B'),
    ];
    const selected = selectExecutionContext(contexts, {
      context: 'content-script',
      extensionId: 'ext-B',
    });
    assert.equal(selected?.id, 2);
  });

  it('page world 不会误选 content-script 上下文', () => {
    const contexts = [
      ctx(1, 'content-script', 'frame-main', 'ext-A'),
      ctx(2, 'page', 'frame-main'),
    ];
    const selected = selectExecutionContext(contexts, {context: 'page'});
    assert.equal(selected?.id, 2);
  });
});
