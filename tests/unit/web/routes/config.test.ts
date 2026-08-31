/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

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
});
