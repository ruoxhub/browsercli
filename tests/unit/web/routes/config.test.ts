/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

import {resetRuntimeConfigStore, getRuntimeConfigStore} from '../../../../src/config/RuntimeConfigStore.js';
import {
  createConfigRoutes,
  isMaskPlaceholder,
  maskApiKey,
} from '../../../../src/web/routes/config.js';

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
  return {req, res, getBody: () => (res as {responseBody: string}).responseBody};
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

  describe('GET /api/config', () => {
    it('returns config with masked apiKeys', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-secretkey9999', model: 'gpt-4o'},
        llmProvider: 'openai',
        databaseUrl: 'postgres://localhost/db',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
      } as never);

      const handler = routes.get('GET /api/config')!;
      const {req, res, getBody} = mockReqRes('GET');

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.openai.apiKey, 'sk-***9999');
      assert.strictEqual(parsed.data.openai.model, 'gpt-4o');
      assert.strictEqual(parsed.data.databaseUrl, 'postgres://localhost/db');
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
  });

  describe('PUT /api/config/browser validation', () => {
    it('returns 400 on invalid browser config', async () => {
      resetRuntimeConfigStore();

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
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
});
