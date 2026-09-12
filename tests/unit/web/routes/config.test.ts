/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

import {loadUserConfig} from '../../../../src/config/resolver.js';
import {
  resetRuntimeConfigStore,
  getRuntimeConfigStore,
} from '../../../../src/config/RuntimeConfigStore.js';
import {createConfigRoutes} from '../../../../src/web/routes/config.js';

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

  describe('GET /api/config', () => {
    it('returns the stored config snapshot', async () => {
      resetRuntimeConfigStore({
        browser: {headless: false, channel: 'stable'},
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
      assert.strictEqual(parsed.data.browser.headless, false);
      assert.strictEqual(parsed.data.browser.channel, 'stable');
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

    it('persists a valid browser config', async () => {
      resetRuntimeConfigStore();

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('PUT /api/config/browser')!;
      const {req, res, getBody} = mockReqRes('PUT', {
        headless: false,
        channel: 'stable',
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(
        getRuntimeConfigStore().get().browser?.headless,
        false,
      );
    });
  });

  describe('GET /api/config/export', () => {
    it('contains only PERSISTED_KEYS', () => {
      resetRuntimeConfigStore({
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
      // 只含白名单 browser
      assert.deepStrictEqual(Object.keys(parsed.data).sort(), ['browser']);
      // 白名单外的键不导出
      assert.strictEqual(parsed.data.browserUrl, undefined);
    });
  });

  describe('POST /api/config/import', () => {
    it('merges with current values instead of replacing', async () => {
      resetRuntimeConfigStore({
        browser: {headless: true, channel: 'stable'},
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/config/import')!;
      const {req, res, getBody} = mockReqRes('POST', {
        browser: {channel: 'canary'},
      });
      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      // 传入的 channel 覆盖
      assert.strictEqual(
        getRuntimeConfigStore().get().browser?.channel,
        'canary',
      );
      // 未传入的 headless 保留当前值（合并语义，非替换）
      assert.strictEqual(getRuntimeConfigStore().get().browser?.headless, true);
    });

    it('rejects a payload that fails schema validation with 400', async () => {
      resetRuntimeConfigStore();

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
        persist: noopPersist,
      } as never);

      const handler = routes.get('POST /api/config/import')!;
      const {req, res, getBody} = mockReqRes('POST', {
        browser: {remoteDebuggingPort: 1},
      });
      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error.code, 'VALIDATION');
    });

    it('calls the injected persist callback after importing', async () => {
      resetRuntimeConfigStore({
        browser: {headless: true},
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
        browser: {headless: false},
      });
      await handler(req, res);

      assert.strictEqual(persistCalls, 1);
    });
  });

  describe('POST /api/config/reset', () => {
    it('deletes the cache file and reseeds from env plus the CLI seed', () => {
      resetRuntimeConfigStore({
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

      // 重置后回到 loadUserConfig() + configSeed 的合并结果，旧值被丢弃。
      const stored = getRuntimeConfigStore().get();
      const expectedSeed = loadUserConfig();
      assert.strictEqual(
        stored.browser?.headless,
        expectedSeed.browser?.headless,
      );
      // configSeed 覆盖 loadUserConfig / 旧值
      assert.strictEqual(stored.headless, true);
    });

    it('returns 500 and skips the reset when the cache delete fails', () => {
      // 注意 headless 必须放在顶层（与 configSeed 同一层），否则这条断言无法
      // 见证“半重置”：错误地把 configSeed 落下去只会改顶层 headless。
      resetRuntimeConfigStore({
        browser: {headless: true},
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
      assert.strictEqual(stored.browser?.headless, true);
      assert.strictEqual(stored.headless, false);
    });
  });
});
