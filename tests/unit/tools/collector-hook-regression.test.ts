/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {collectCode as toolCollectCode} from '../../../src/tools/collector/collectCode.js';
import {setRuntime} from '../../../src/runtime.js';
import {
  buildRequestBindings,
  getHookData as toolGetHookData,
  inferCandidateEnvNeeds,
  normalizeHookRecord,
  removeHookBrowser as toolRemoveHookBrowser,
  summarizeHookRecords,
  syncHookRecords as toolSyncHookRecords,
  toHookRecordArray,
} from '../../../src/tools/hook/index.js';

async function collectCode(runtime: any, params?: any) {
  setRuntime(runtime);
  const request = { params: params || {} };
  const response = {
    structuredContent: null as any,
    setStructuredContent(content: any) {
      this.structuredContent = content;
    }
  };
  const context = {
    getSelectedFrame: () => null
  };
  try {
    await toolCollectCode.handler(request as any, response as any, context as any);
    return response.structuredContent;
  } finally {
    setRuntime(undefined);
  }
}


async function getHookData(frame: any, params?: any) {
  const request = { params: params || {} };
  const response = {
    structuredContent: null as any,
    setStructuredContent(content: any) {
      this.structuredContent = content;
    }
  };
  const context = {
    getSelectedFrame: () => frame
  };
  await toolGetHookData.handler(request as any, response as any, context as any);
  return response.structuredContent;
}

async function syncHookRecords(frame: any, params?: any) {
  const request = { params: params || {} };
  const response = {
    structuredContent: null as any,
    setStructuredContent(content: any) {
      this.structuredContent = content;
    }
  };
  const context = {
    getSelectedFrame: () => frame
  };
  await toolSyncHookRecords.handler(request as any, response as any, context as any);
  return response.structuredContent;
}

async function removeHookBrowser(frame: any, params?: any) {
  const request = { params: params || {} };
  const response = {
    structuredContent: null as any,
    setStructuredContent(content: any) {
      this.structuredContent = content;
    }
  };
  const context = {
    getSelectedFrame: () => frame
  };
  await toolRemoveHookBrowser.handler(request as any, response as any, context as any);
  return response.structuredContent;
}

describe('collector/hook regressions', () => {
  it('collect_code should collect before top-priority view', async () => {
    const runtime = {
      collector: {
        collectCalls: 0,
        async collect() {
          this.collectCalls += 1;
          return {
            files: [
              {
                url: 'https://example.com/a.js',
                content: 'const a=1;',
                size: 10,
                type: 'external',
              },
            ],
            dependencies: {nodes: [], edges: []},
            totalSize: 10,
            collectTime: 1,
          };
        },
        getCollectedFilesSummary() {
          return [];
        },
        getTopPriorityFiles() {
          return {
            files: [
              {
                url: 'https://example.com/a.js',
                content: 'const a=1;',
                size: 10,
                type: 'external',
              },
            ],
            totalSize: 10,
            totalFiles: 1,
          };
        },
      },
    };

    const result = await collectCode(runtime as never, {
      url: 'https://example.com',
      returnMode: 'top-priority',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(
      runtime.collector.collectCalls,
      1,
      'collect_code should trigger collector.collect first',
    );
    assert.deepStrictEqual(result.data, {
      files: [
        {
          url: 'https://example.com/a.js',
          content: 'const a=1;',
          size: 10,
          type: 'external',
        },
      ],
      totalSize: 10,
      totalFiles: 1,
    });
  });

  it('get_hook_data should sync data from window.__hookStore', async () => {
    const created = {hookId: 'fetch_hook'};
    const frame = {
      evaluate: async (_fn: unknown, hookId?: string) => ({
        [hookId || created.hookId]: [
          {
            hookId: hookId || created.hookId,
            target: 'fetch',
            event: 'request',
            method: 'GET',
            url: 'https://example.com/api',
            status: 200,
            body: '{"ok":true}',
            timestamp: Date.now(),
          },
        ],
      }),
    };

    const result = await getHookData(frame as never, {hookId: created.hookId});

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, {
      [created.hookId]: [
        {
          hookId: created.hookId,
          target: 'fetch',
          event: 'request',
          method: 'GET',
          url: 'https://example.com/api',
          status: 200,
          body: '{"ok":true}',
          timestamp:
            result.data &&
            (result.data as Record<string, Array<{timestamp: number}>>)[
              created.hookId
            ]?.[0]?.timestamp,
        },
      ],
    });
  });

  it('get_hook_data summary should respect maxRecords and produce summary rows', async () => {
    const created = {hookId: 'fetch_hook'};
    const frame = {
      evaluate: async (_fn: unknown, hookId?: string) => ({
        [hookId || created.hookId]: [
          {
            hookId: hookId || created.hookId,
            target: 'fetch',
            event: 'request',
            timestamp: 1,
          },
          {
            hookId: hookId || created.hookId,
            target: 'fetch',
            event: 'response',
            timestamp: 2,
          },
        ],
      }),
    };

    const result = await getHookData(frame as never, {
      hookId: created.hookId,
      view: 'summary',
      maxRecords: 1,
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, {
      view: 'summary',
      totalHooks: 1,
      totalRecords: 2,
      hooks: [
        {
          hookId: created.hookId,
          type: 'fetch',
          total: 2,
          lastEvent: 'response',
          lastTarget: 'fetch',
          lastTimestamp: 2,
          recentRecords: [
            {
              hookId: created.hookId,
              target: 'fetch',
              event: 'response',
              timestamp: 2,
            },
          ],
        },
      ],
    });
  });

  it('get_hook_data should include hooks that only have raw records', async () => {
    const orphanHookId = 'function_hook_only';
    const frame = {
      evaluate: async () => ({
        [orphanHookId]: [
          {
            hookId: orphanHookId,
            target: 'window.fetch',
            event: 'call',
            method: 'GET',
            url: 'https://example.com/raw',
            timestamp: Date.now(),
          },
        ],
      }),
    };

    const result = await getHookData(frame as never);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, {
      [orphanHookId]: [
        {
          hookId: orphanHookId,
          target: 'window.fetch',
          event: 'call',
          method: 'GET',
          url: 'https://example.com/raw',
          timestamp:
            result.data &&
            (result.data as Record<string, Array<{timestamp: number}>>)[
              orphanHookId
            ]?.[0]?.timestamp,
        },
      ],
    });
  });

  it('get_hook_data should keep explicitly installed hooks even when no records were captured yet', async () => {
    const frame = {
      evaluate: async (_fn: unknown, hookId?: string) => ({
        [hookId || 'hook_fetch']: [],
      }),
    };

    const result = await getHookData(frame as never, {
      hookId: 'hook_fetch',
      view: 'detail',
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, {
      view: 'detail',
      totalHooks: 1,
      totalRecords: 0,
      normalizedRecords: [],
      diagnostics: [
        {
          hookId: 'hook_fetch',
          type: 'fetch',
          issue: 'hook_installed_no_records',
          likelyCauses: [
            '目标业务动作尚未触发',
            'Hook 注入晚于页面签名逻辑初始化',
            '当前选中的 Frame 与请求所在 Frame 不一致',
            '目标请求未经过该 Hook 类型',
          ],
          nextSteps: [
            '触发登录、下单、分页等目标业务动作后重新读取 get_hook_data',
            '使用 inject_preload_script 或在页面加载前安装 Hook',
            '用 list_frames / select_frame 确认 Hook 注入到正确 Frame',
            '升级到 xhr_to_js_breakpoint、get_paused_info、evaluate_on_callframe 调试链路',
          ],
        },
      ],
      summary: {
        total: 0,
        unique: 0,
        dropped: 0,
        records: [],
      },
      candidateEnvNeeds: [],
      requestBindings: [],
    });
  });

  it('get_hook_data detail should normalize records and derive helper views', async () => {
    const frame = {
      evaluate: async () => ({
        legacy_hook: [
          {
            target: 'fetch',
            event: 'request',
            method: 'post',
            requestUrl: 'https://example.com/api/login',
            requestBody: 'token=abc&nonce=xyz',
            status: 200,
            timestamp: 10,
          },
        ],
      }),
    };

    const result = await getHookData(frame as never, {
      view: 'detail',
      maxRecords: 5,
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, {
      view: 'detail',
      totalHooks: 1,
      totalRecords: 1,
      normalizedRecords: [
        {
          hookId: 'legacy_hook',
          type: 'fetch',
          target: 'fetch',
          event: 'request',
          phase: undefined,
          method: 'POST',
          url: 'https://example.com/api/login',
          status: 200,
          bodySnippet: 'token=abc&nonce=xyz',
          timestamp: 10,
        },
      ],
      summary: {
        total: 1,
        unique: 1,
        dropped: 0,
        records: [
          {
            hookId: 'legacy_hook',
            type: 'fetch',
            target: 'fetch',
            event: 'request',
            phase: undefined,
            method: 'POST',
            url: 'https://example.com/api/login',
            status: 200,
            bodySnippet: 'token=abc&nonce=xyz',
            timestamp: 10,
            count: 1,
          },
        ],
      },
      candidateEnvNeeds: ['Date', 'cookie', 'fetch', 'location', 'storage'],
      requestBindings: [
        {
          hookId: 'legacy_hook',
          type: 'fetch',
          event: 'request',
          method: 'POST',
          url: 'https://example.com/api/login',
          status: 200,
        },
      ],
    });
  });

  it('get_hook_data should reject invalid view values', async () => {
    const frame = {
      evaluate: async () => ({}),
    };

    const result = await getHookData(frame as never, {
      view: 'full' as 'raw',
    });

    assert.strictEqual(result.success, false);
    assert.match(result.message, /view 参数无效/);
    assert.strictEqual(result.data, null);
  });

  it('hook browser management tools should accept frame callMode params objects', async () => {
    const evaluateCalls: Array<{
      kind: 'reader' | 'cleanup';
      hookId?: string;
      script?: string;
    }> = [];
    const frame = {
      evaluate: async (arg: unknown, hookId?: string) => {
        if (typeof arg === 'function') {
          evaluateCalls.push({kind: 'reader', hookId});
          return {
            [hookId || 'all']: [{event: 'call', target: 'window.fetch'}],
          };
        }

        evaluateCalls.push({kind: 'cleanup', script: String(arg)});
        return undefined;
      },
    };

    const getResult = await getHookData(frame as never, {
      hookId: 'hook_from_params',
    });
    const syncResult = await syncHookRecords(frame as never, {
      hookId: 'hook_from_params',
    });
    const removeResult = await removeHookBrowser(frame as never, {
      hookId: 'hook_from_params',
    });

    assert.strictEqual(getResult.success, true);
    assert.match(getResult.message, /hook_from_params/);
    assert.deepStrictEqual(getResult.data, {
      hook_from_params: [{event: 'call', target: 'window.fetch'}],
    });

    assert.strictEqual(syncResult.success, true);
    assert.strictEqual(syncResult.tooltype, 'list_created_hooks');
    assert.deepStrictEqual(syncResult.syncedHookIds, ['hook_from_params']);
    assert.strictEqual(syncResult.totalRecords, 1);
    assert.deepStrictEqual(syncResult.hooks, [
      {hookId: 'hook_from_params', total: 1, type: 'fetch'},
    ]);

    assert.strictEqual(removeResult.success, true);
    assert.strictEqual(removeResult.tooltype, 'remove_hook');
    assert.strictEqual(removeResult.hookId, 'hook_from_params');
    assert.match(removeResult.message, /hook_from_params/);

    const readerHookIds = evaluateCalls
      .filter(call => call.kind === 'reader')
      .map(call => call.hookId);
    assert.deepStrictEqual(readerHookIds, [
      'hook_from_params',
      'hook_from_params',
    ]);

    const cleanupCall = evaluateCalls.find(call => call.kind === 'cleanup');
    assert.ok(cleanupCall?.script?.includes('__hookStore'));
    assert.ok(cleanupCall?.script?.includes('"hook_from_params"'));
  });

  it('list_created_hooks should support verbose summaries', async () => {
    const frame = {
      evaluate: async () => ({
        hook_a: [
          {target: 'window.fetch', event: 'request', timestamp: 1},
          {target: 'window.fetch', event: 'response', timestamp: 2},
        ],
      }),
    };

    const result = await syncHookRecords(frame as never, {verbose: true});

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.hooks, [
      {
        hookId: 'hook_a',
        type: 'fetch',
        total: 2,
        lastEvent: 'response',
        lastTarget: 'window.fetch',
        lastTimestamp: 2,
        recentRecords: [
          {target: 'window.fetch', event: 'request', timestamp: 1},
          {target: 'window.fetch', event: 'response', timestamp: 2},
        ],
      },
    ]);
  });

  it('list_created_hooks should include initialized hooks with zero records', async () => {
    const frame = {
      evaluate: async () => ({
        hook_fetch: [],
      }),
    };

    const result = await syncHookRecords(frame as never);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.message, '同步完成，1 个 Hook，共 0 条记录');
    assert.deepStrictEqual(result.syncedHookIds, ['hook_fetch']);
    assert.strictEqual(result.totalRecords, 0);
    assert.deepStrictEqual(result.hooks, [
      {hookId: 'hook_fetch', total: 0, type: 'fetch'},
    ]);
  });

  it('consumer filters should narrow records by type/event/phase', async () => {
    const frame = {
      evaluate: async () => ({
        hook_a: [
          {
            type: 'fetch',
            target: 'window.fetch',
            event: 'request',
            phase: 'before',
            timestamp: 1,
          },
          {
            type: 'fetch',
            target: 'window.fetch',
            event: 'response',
            phase: 'success',
            timestamp: 2,
          },
        ],
        hook_b: [
          {
            type: 'xhr',
            target: 'XMLHttpRequest.open',
            event: 'open',
            phase: 'before',
            timestamp: 3,
          },
        ],
      }),
    };

    const hookDataResult = await getHookData(frame as never, {
      view: 'summary',
      type: 'fetch',
      event: 'response',
      phase: 'success',
    });
    const listResult = await syncHookRecords(frame as never, {
      type: 'xhr',
      phase: 'before',
      verbose: true,
    });

    assert.deepStrictEqual(hookDataResult.data, {
      view: 'summary',
      totalHooks: 1,
      totalRecords: 1,
      hooks: [
        {
          hookId: 'hook_a',
          type: 'fetch',
          total: 1,
          lastEvent: 'response',
          lastTarget: 'window.fetch',
          lastTimestamp: 2,
          recentRecords: [
            {
              type: 'fetch',
              target: 'window.fetch',
              event: 'response',
              phase: 'success',
              timestamp: 2,
            },
          ],
        },
      ],
    });

    assert.deepStrictEqual(listResult.hooks, [
      {
        hookId: 'hook_b',
        type: 'xhr',
        total: 1,
        lastEvent: 'open',
        lastTarget: 'XMLHttpRequest.open',
        lastTimestamp: 3,
        recentRecords: [
          {
            type: 'xhr',
            target: 'XMLHttpRequest.open',
            event: 'open',
            phase: 'before',
            timestamp: 3,
          },
        ],
      },
    ]);
  });

  it('record utility helpers should normalize legacy records consistently', () => {
    const rawRecords = [
      {
        target: 'fetch',
        event: 'request',
        method: 'post',
        requestUrl: 'https://example.com/api',
        requestBody: 'cookie=session_id&timestamp=123',
        status: 200,
        timestamp: 1,
      },
      null,
      'bad',
    ];

    const records = toHookRecordArray(rawRecords);
    const normalized = records.map(record => normalizeHookRecord(record));
    const summary = summarizeHookRecords(normalized, 10);
    const envNeeds = inferCandidateEnvNeeds(normalized);
    const bindings = buildRequestBindings(normalized);

    assert.strictEqual(records.length, 1);
    assert.deepStrictEqual(normalized, [
      {
        hookId: undefined,
        type: 'fetch',
        target: 'fetch',
        event: 'request',
        phase: undefined,
        method: 'POST',
        url: 'https://example.com/api',
        status: 200,
        bodySnippet: 'cookie=session_id&timestamp=123',
        timestamp: 1,
      },
    ]);
    assert.strictEqual(summary.total, 1);
    assert.deepStrictEqual(envNeeds, ['Date', 'cookie', 'fetch', 'location']);
    assert.deepStrictEqual(bindings, [
      {
        hookId: undefined,
        type: 'fetch',
        event: 'request',
        method: 'POST',
        url: 'https://example.com/api',
        status: 200,
      },
    ]);
  });

  it('get_hook_data detail should normalize autoHook crypto/eval/timer records', async () => {
    const frame = {
      evaluate: async () => ({
        hook_cryptojs_auto: [
          {
            hookId: 'hook_cryptojs_auto',
            target: 'Function.prototype.apply',
            event: 'encrypt',
            phase: 'before',
            algorithm: 'AES',
            ciphertext: 'cipher-abc',
            timestamp: 11,
          },
        ],
        hook_eval_auto: [
          {
            hookId: 'hook_eval_auto',
            target: 'window.eval',
            event: 'eval',
            phase: 'before',
            code: 'localStorage.getItem("token")',
            timestamp: 12,
          },
        ],
        hook_timers_auto: [
          {
            hookId: 'hook_timers_auto',
            target: 'window.setTimeout',
            event: 'setTimeout',
            phase: 'before',
            fnSnippet: '() => fetch("/sign")',
            timestamp: 13,
          },
        ],
      }),
    };

    const result = await getHookData(frame as never, {
      view: 'detail',
      maxRecords: 10,
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, {
      view: 'detail',
      totalHooks: 3,
      totalRecords: 3,
      normalizedRecords: [
        {
          hookId: 'hook_cryptojs_auto',
          type: 'cryptojs',
          target: 'Function.prototype.apply',
          event: 'encrypt',
          phase: 'before',
          method: '',
          url: '',
          status: undefined,
          bodySnippet: 'cipher-abc',
          timestamp: 11,
        },
        {
          hookId: 'hook_eval_auto',
          type: 'eval',
          target: 'window.eval',
          event: 'eval',
          phase: 'before',
          method: '',
          url: '',
          status: undefined,
          bodySnippet: 'localStorage.getItem("token")',
          timestamp: 12,
        },
        {
          hookId: 'hook_timers_auto',
          type: 'timer',
          target: 'window.setTimeout',
          event: 'setTimeout',
          phase: 'before',
          method: '',
          url: '',
          status: undefined,
          bodySnippet: '() => fetch("/sign")',
          timestamp: 13,
        },
      ],
      summary: {
        total: 3,
        unique: 3,
        dropped: 0,
        records: [
          {
            hookId: 'hook_timers_auto',
            type: 'timer',
            target: 'window.setTimeout',
            event: 'setTimeout',
            phase: 'before',
            method: '',
            url: '',
            status: undefined,
            bodySnippet: '() => fetch("/sign")',
            timestamp: 13,
            count: 1,
          },
          {
            hookId: 'hook_eval_auto',
            type: 'eval',
            target: 'window.eval',
            event: 'eval',
            phase: 'before',
            method: '',
            url: '',
            status: undefined,
            bodySnippet: 'localStorage.getItem("token")',
            timestamp: 12,
            count: 1,
          },
          {
            hookId: 'hook_cryptojs_auto',
            type: 'cryptojs',
            target: 'Function.prototype.apply',
            event: 'encrypt',
            phase: 'before',
            method: '',
            url: '',
            status: undefined,
            bodySnippet: 'cipher-abc',
            timestamp: 11,
            count: 1,
          },
        ],
      },
      candidateEnvNeeds: ['cookie', 'storage'],
      requestBindings: [],
    });
  });

  it('get_hook_data detail should collapse fetch request/response into one requestBinding', async () => {
    const frame = {
      evaluate: async () => ({
        hook_fetch_auto: [
          {
            hookId: 'hook_fetch_auto',
            type: 'fetch',
            target: 'window.fetch',
            event: 'request',
            phase: 'before',
            method: 'POST',
            url: 'https://example.com/api/login',
            body: '{"user":"a"}',
            timestamp: 21,
          },
          {
            hookId: 'hook_fetch_auto',
            type: 'fetch',
            target: 'window.fetch',
            event: 'response',
            phase: 'success',
            method: 'POST',
            url: 'https://example.com/api/login',
            status: 200,
            statusText: 'OK',
            timestamp: 22,
          },
        ],
      }),
    };

    const result = await getHookData(frame as never, {
      view: 'detail',
      maxRecords: 10,
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(
      (result.data as {requestBindings: unknown[]}).requestBindings,
      [
        {
          hookId: 'hook_fetch_auto',
          type: 'fetch',
          event: 'request',
          method: 'POST',
          url: 'https://example.com/api/login',
          status: 200,
        },
      ],
    );
  });
});
