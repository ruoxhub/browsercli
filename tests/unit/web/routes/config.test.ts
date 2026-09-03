/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

import {configFromEnv} from '../../../../src/config/resolver.js';
import {
  resetRuntimeConfigStore,
  getRuntimeConfigStore,
} from '../../../../src/config/RuntimeConfigStore.js';
import {
  createConfigRoutes,
  isMaskPlaceholder,
  maskApiKey,
  validateLlmBaseUrl,
} from '../../../../src/web/routes/config.js';

/** 测试用 no-op 持久化回调（共享实例，避免每处写空函数触发 lint）。 */
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noopPersist = (): void => {};

function mockReqRes(method: string, body?: unknown) {
  const chunks: Buffer[] = [];
  if (body !== undefined) {
    chunks.push(Buffer.from(JSON.stringify(body)));
  }
  const req = {
    method,
    url: '/api/config',
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === 'data' && chunks.length > 0) cb(chunks.shift());
      if (event === 'end') cb();
    },
  } as never;
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    end(body: string) {
      this.responseBody = body;
    },
    responseBody: '',
    get headersSent() {
      return false;
    },
  } as never;
  return {
    req,
    res,
    getBody: () => (res as {responseBody: string}).responseBody,
  };
}

describe('config routes', () => {
  afterEach(() => {
    resetRuntimeConfigStore();
  });

  describe('maskApiKey', () => {
    it('masks key showing only last 4 chars', () => {
      assert.strictEqual(maskApiKey('sk-abcdef1234'), 'sk-***1234');
    });

    it('returns empty string for empty input', () => {
      assert.strictEqual(maskApiKey(''), '');
    });

    it('returns mask for very short keys', () => {
      assert.strictEqual(maskApiKey('ab'), '***');
    });
  });

  describe('isMaskPlaceholder', () => {
    it('detects mask placeholder pattern', () => {
      assert.ok(isMaskPlaceholder('sk-***1234'));
    });

    it('returns false for real keys', () => {
      assert.strictEqual(isMaskPlaceholder('sk-real-key-1234'), false);
    });

    it('returns false for empty string', () => {
      assert.strictEqual(isMaskPlaceholder(''), false);
    });
  });

  describe('validateLlmBaseUrl', () => {
    it('accepts undefined/empty baseURL', () => {
      assert.strictEqual(validateLlmBaseUrl(undefined), undefined);
      assert.strictEqual(validateLlmBaseUrl(''), undefined);
    });

    it('accepts public https baseURL', () => {
      assert.strictEqual(
        validateLlmBaseUrl('https://api.openai.com/v1'),
        undefined,
      );
    });

    it('accepts local / LAN http baseURL', () => {
      assert.strictEqual(
        validateLlmBaseUrl('http://192.168.1.11:18000/v1'),
        undefined,
      );
      assert.strictEqual(
        validateLlmBaseUrl('http://localhost:11434/v1'),
        undefined,
      );
      assert.strictEqual(
        validateLlmBaseUrl('http://127.0.0.1:8000/v1'),
        undefined,
      );
    });

    it('rejects unsupported protocols', () => {
      assert.strictEqual(
        validateLlmBaseUrl('ftp://example.com/v1'),
        '仅允许 http 或 https 协议的 baseURL',
      );
      assert.strictEqual(
        validateLlmBaseUrl('file:///etc/passwd'),
        '仅允许 http 或 https 协议的 baseURL',
      );
    });

    it('rejects malformed URLs', () => {
      assert.strictEqual(
        validateLlmBaseUrl('not-a-valid-url'),
        '无效的 URL 格式',
      );
    });
  });

  describe('GET /api/config', () => {
    it('returns config with masked apiKeys', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-secretkey9999', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('GET /api/config')!;
      const {req, res, getBody} = mockReqRes('GET');

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.openai.apiKey, 'sk-***9999');
      assert.strictEqual(parsed.data.openai.model, 'gpt-4o');
    });
  });

  describe('PUT /api/config/llm mask placeholder preservation', () => {
    it('preserves existing apiKey when placeholder is sent', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-original1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('PUT /api/config/llm')!;
      const {req, res, getBody} = mockReqRes('PUT', {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-***1234', model: 'gpt-4o-mini'},
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      // Response shows masked apiKey
      assert.strictEqual(parsed.data.openai.apiKey, 'sk-***1234');
      // model updated to new value
      assert.strictEqual(parsed.data.openai.model, 'gpt-4o-mini');
      // Store retains original apiKey (placeholder did not overwrite)
      assert.strictEqual(
        getRuntimeConfigStore().get().openai?.apiKey,
        'sk-original1234',
      );
    });

    it('overwrites apiKey when real value is sent', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-old1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('PUT /api/config/llm')!;
      const {req, res, getBody} = mockReqRes('PUT', {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-newrealkey5678'},
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      // Response shows masked new apiKey
      assert.strictEqual(parsed.data.openai.apiKey, 'sk-***5678');
      // Store has the real new value
      assert.strictEqual(
        getRuntimeConfigStore().get().openai?.apiKey,
        'sk-newrealkey5678',
      );
    });

    it('keeps stored apiKey when empty string is sent (留空则不修改)', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-keepme9999', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('PUT /api/config/llm')!;
      const {req, res, getBody} = mockReqRes('PUT', {
        llmProvider: 'openai',
        openai: {
          apiKey: '',
          baseURL: 'https://newapi.example.com/v1',
          model: 'deepseek-v4-flash',
        },
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      // apiKey 未被清空（空字符串按「留空则不修改」处理）
      assert.strictEqual(parsed.data.openai.apiKey, 'sk-***9999');
      assert.strictEqual(
        getRuntimeConfigStore().get().openai?.apiKey,
        'sk-keepme9999',
      );
      // 其余字段正常更新
      assert.strictEqual(
        getRuntimeConfigStore().get().openai?.model,
        'deepseek-v4-flash',
      );
    });
  });

  describe('PUT /api/config/browser validation', () => {
    it('returns 400 on invalid browser config', async () => {
      resetRuntimeConfigStore();

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('PUT /api/config/browser')!;
      const {req, res, getBody} = mockReqRes('PUT', {
        remoteDebuggingPort: 80,
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error.code, 'VALIDATION');
      assert.ok(parsed.error.message.includes('remoteDebuggingPort'));
    });
  });

  describe('POST /api/llm/test', () => {
    function fakeAIService(
      factory: () => {chat: () => Promise<{content: string}>},
    ) {
      return {createAIService: factory};
    }

    it('returns ok:true when chat succeeds', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-stored1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
        ...fakeAIService(() => ({
          chat: async () => ({content: 'pong'}),
        })),
      } as never);

      const handler = routes.get('POST /api/llm/test')!;
      const {req, res, getBody} = mockReqRes('POST', {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-***1234'},
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.ok, true);
      assert.strictEqual(parsed.data.provider, 'openai');
      assert.ok(typeof parsed.data.latencyMs === 'number');
    });

    it('returns ok:false with 502 when chat fails', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-stored1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
        ...fakeAIService(() => ({
          chat: async () => {
            throw new Error('unauthorized');
          },
        })),
      } as never);

      const handler = routes.get('POST /api/llm/test')!;
      const {req, res, getBody} = mockReqRes('POST', {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-***1234'},
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error.code, 'LLM_TEST_FAILED');
      assert.ok(parsed.error.message.includes('unauthorized'));
    });

    it('returns 400 when provider config is missing', async () => {
      resetRuntimeConfigStore({llmProvider: 'openai'});

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
        createAIService: () => {
          throw new Error('OpenAI configuration not found');
        },
      } as never);

      const handler = routes.get('POST /api/llm/test')!;
      const {req, res, getBody} = mockReqRes('POST', {llmProvider: 'openai'});

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error.code, 'LLM_CONFIG_INVALID');
    });
  });

  describe('POST /api/llm/models', () => {
    let originalFetch: typeof globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    function mockFetch(
      impl: (
        url: string,
        init: {headers: Record<string, string>},
      ) => {
        ok: boolean;
        status: number;
        json: () => Promise<unknown>;
        text: () => Promise<string>;
      },
    ) {
      originalFetch = globalThis.fetch;
      (globalThis as {fetch: unknown}).fetch = impl;
    }

    it('returns model list from /v1/models using stored real key', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-stored1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      let capturedUrl = '';
      let capturedAuth = '';
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedAuth = init.headers['Authorization'] ?? '';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            object: 'list',
            data: [
              {id: 'gpt-4o', object: 'model', owned_by: 'openai'},
              {id: 'gpt-4o-mini', object: 'model', owned_by: 'openai'},
            ],
          }),
          text: async () => '',
        };
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/llm/models')!;
      // 传入掩码占位符，后端应回退到存储的真实密钥
      const {req, res, getBody} = mockReqRes('POST', {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-***1234'},
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.models.length, 2);
      assert.strictEqual(parsed.data.models[0].id, 'gpt-4o');
      assert.strictEqual(capturedUrl, 'https://api.openai.com/v1/models');
      // 真实密钥被带往上游客端
      assert.strictEqual(capturedAuth, 'Bearer sk-stored1234');
    });

    it('supports custom http / LAN baseURL when fetching models', async () => {
      resetRuntimeConfigStore({
        openai: {
          apiKey: 'sk-custom1234',
          baseURL: 'http://192.168.1.11:18000/v1',
          model: 'hy3-free',
        },
        llmProvider: 'openai',
      });

      let capturedUrl = '';
      mockFetch(url => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            object: 'list',
            data: [{id: 'hy3-free', object: 'model', owned_by: 'custom'}],
          }),
          text: async () => '',
        };
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/llm/models')!;
      const {req, res, getBody} = mockReqRes('POST', {
        llmProvider: 'openai',
        openai: {
          apiKey: 'sk-***1234',
          baseURL: 'http://192.168.1.11:18000/v1',
        },
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.models.length, 1);
      assert.strictEqual(parsed.data.models[0].id, 'hy3-free');
      assert.strictEqual(capturedUrl, 'http://192.168.1.11:18000/v1/models');
    });

    it('returns 400 when no apiKey configured', async () => {
      resetRuntimeConfigStore({llmProvider: 'openai'});

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/llm/models')!;
      const {req, res, getBody} = mockReqRes('POST', {llmProvider: 'openai'});

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error.code, 'LLM_CONFIG_INVALID');
    });

    it('returns 502 when upstream fails', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-stored1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      mockFetch(() => ({
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => 'unauthorized',
      }));

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/llm/models')!;
      const {req, res, getBody} = mockReqRes('POST', {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-***1234'},
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error.code, 'LLM_MODELS_FETCH_FAILED');
      assert.ok(parsed.error.message.includes('401'));
    });
  });

  describe('GET /api/config/export', () => {
    it('contains only PERSISTED_KEYS with a masked apiKey', () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-export1234', model: 'gpt-4o'},
        llmProvider: 'openai',
        browser: {headless: true},
        browserUrl: 'http://fixed:9222',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('GET /api/config/export')!;
      const {req, res, getBody} = mockReqRes('GET');
      handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      // 只含白名单三项
      assert.deepStrictEqual(Object.keys(parsed.data).sort(), [
        'browser',
        'llmProvider',
        'openai',
      ]);
      // apiKey 恒掩码
      assert.strictEqual(parsed.data.openai.apiKey, 'sk-***1234');
      // 白名单外的键不导出
      assert.strictEqual(parsed.data.browserUrl, undefined);
    });
  });

  describe('POST /api/config/import', () => {
    it('merges with current values instead of replacing', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-current1234', model: 'gpt-4o'},
        llmProvider: 'openai',
        browser: {headless: true, channel: 'stable'},
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/config/import')!;
      const {req, res, getBody} = mockReqRes('POST', {
        llmProvider: 'openai',
        openai: {model: 'gpt-4o-mini'},
      });
      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      // 传入的 model 覆盖
      assert.strictEqual(
        getRuntimeConfigStore().get().openai?.model,
        'gpt-4o-mini',
      );
      // 未传入的 browser 保留当前值（合并语义，非替换）
      assert.deepStrictEqual(getRuntimeConfigStore().get().browser, {
        headless: true,
        channel: 'stable',
      });
    });

    it('keeps the stored apiKey when the payload carries a mask placeholder', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-real1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/config/import')!;
      const {req, res, getBody} = mockReqRes('POST', {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-***1234', model: 'gpt-4o-mini'},
      });
      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      // 掩码占位符不覆盖真实密钥
      assert.strictEqual(
        getRuntimeConfigStore().get().openai?.apiKey,
        'sk-real1234',
      );
      assert.strictEqual(
        getRuntimeConfigStore().get().openai?.model,
        'gpt-4o-mini',
      );
    });

    it('rejects a payload that fails schema validation with 400', async () => {
      resetRuntimeConfigStore({llmProvider: 'openai'});

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/config/import')!;
      const {req, res, getBody} = mockReqRes('POST', {
        llmProvider: 'not-a-provider',
      });
      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error.code, 'VALIDATION');
    });

    it('calls the injected persist callback after importing', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-persist1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      let persistCalls = 0;
      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: () => {
          persistCalls += 1;
        },
      } as never);

      const handler = routes.get('POST /api/config/import')!;
      const {req, res} = mockReqRes('POST', {
        llmProvider: 'openai',
        openai: {model: 'gpt-4o-mini'},
      });
      await handler(req, res);

      assert.strictEqual(persistCalls, 1);
    });

    it('treats an empty apiKey as “留空则不修改” instead of throwing', async () => {
      // store 里 llmProvider 已是 openai，但 payload 不带 llmProvider ——
      // 这样 GlobalConfigSchema 的 superRefine 不会在入口拦住 ''，
      // 空串会一路走到 store.update 里的 validateGlobalConfig 抛错（修复前）。
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-keepme1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/config/import')!;
      const {req, res, getBody} = mockReqRes('POST', {
        openai: {apiKey: ''},
      });
      // 修复前：此处抛出（handler 逸出），由 RestRouter 兜底成 500 INTERNAL + 裸 zod 文本。
      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual((res as {statusCode: number}).statusCode, 200);
      // 密钥不得被清空
      assert.strictEqual(
        getRuntimeConfigStore().get().openai?.apiKey,
        'sk-keepme1234',
      );
    });
  });

  describe('POST /api/config/reset', () => {
    it('deletes the cache file and reseeds from env plus the CLI seed', () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-dirty1234', model: 'dirty-model'},
        browser: {headless: false},
      });

      let deleteCalls = 0;
      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
        deleteConfig: () => {
          deleteCalls += 1;
          return true;
        },
        configSeed: {headless: true},
      } as never);

      const handler = routes.get('POST /api/config/reset')!;
      const {req, res, getBody} = mockReqRes('POST', {});
      handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(deleteCalls, 1);

      // 重置后回到 configFromEnv() + configSeed 的合并结果，旧值被丢弃。
      // 注意：configFromEnv() 会读开发者机器上真实的 OPENAI_* / BROWSER_* 环境变量，
      // 所以断言必须拿 configFromEnv() 的返回值当基准，不能写死 undefined ——
      // 否则任何设置了 OPENAI_MODEL 的机器都会让这条测试红。
      const stored = getRuntimeConfigStore().get();
      const envSeed = configFromEnv();
      assert.strictEqual(stored.openai?.model, envSeed.openai?.model);
      // configSeed 覆盖 env / 旧值
      assert.strictEqual(stored.headless, true);
      // 旧值已被丢弃（'dirty-model' 不是 env 值时才有意义，故用不等断言兜底）
      assert.notStrictEqual(stored.openai?.apiKey, 'sk-dirty1234');
    });

    it('returns 500 and skips the reset when the cache delete fails', () => {
      // 注意 headless 必须放在顶层（与 configSeed 同一层），否则这条断言无法
      // 见证“半重置”：错误地把 configSeed 落下去只会改顶层 headless。
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-keepme1234', model: 'keep-model'},
        headless: false,
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
        // 模拟 EPERM/EBUSY：文件删不掉
        deleteConfig: () => false,
        configSeed: {headless: true},
      } as never);

      const handler = routes.get('POST /api/config/reset')!;
      const {req, res, getBody} = mockReqRes('POST', {});
      handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error.code, 'CONFIG_DELETE_FAILED');
      // 关键：删除失败时 store 必须原封不动（不能“半重置”）
      const stored = getRuntimeConfigStore().get();
      assert.strictEqual(stored.openai?.apiKey, 'sk-keepme1234');
      assert.strictEqual(stored.headless, false);
    });
  });
});
