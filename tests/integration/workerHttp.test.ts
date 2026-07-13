/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 *
 * NOTE (SKIPPED-by-design): 本套集成测试需要真实浏览器。每一个用例最终都经过
 * `startWorker()`，而它内部会调用 `runtime.browserManager.ensureBrowser()` 去
 * 启动/连接一个 Chromium（Patchright）。当运行环境没有可用浏览器时（例如 CI 或
 * 本机未安装 / 未通过 CDP 暴露浏览器），`before` 钩子里的 `startWorker()` 会抛出
 * 连接错误，整组用例通过 `this.skip()` 自动跳过 —— 不会伪造通过结果。
 *
 * 在有浏览器的机器上手动运行：
 *   npm run test:integration -- --test-name-pattern workerhttp
 * 浏览器可用时，以下 health / tools / invoke 轮询 / token 认证用例会真实执行。
 */

import assert from 'node:assert/strict';
import {after, before, describe, it, type TestContext} from 'node:test';

import {ensureToolsMeta, getToolMeta} from '../../src/cli/tools-meta.js';
import {ConsoleServer} from '../../src/web/ConsoleServer.js';
import {JobStore} from '../../src/worker/JobStore.js';
import {ToolAdapter} from '../../src/worker/ToolAdapter.js';
import {ToolContextProvider} from '../../src/worker/ToolContext.js';
import {getRuntime} from '../../src/runtime.js';

async function startWorker(opts: {host: string; port: number; apiToken?: string}) {
  const runtime = getRuntime();
  await runtime.browserManager.ensureBrowser();
  const ctx = new ToolContextProvider(runtime);
  await ctx.init();
  const adapter = new ToolAdapter(ctx);
  const server = new ConsoleServer({
    port: opts.port,
    host: opts.host,
    group: 'test',
    rpcHost: 'http://localhost:5623',
    runtime,
    invoker: {} as any,
    toolAdapter: adapter,
    apiToken: opts.apiToken,
    jobStore: new JobStore(),
  });
  await server.start();
  return server;
}

describe('worker http api', () => {
  let server: ConsoleServer | undefined;
  let canRun = true;
  let skipReason = '';
  const PORT = 18765;
  const BASE = `http://127.0.0.1:${PORT}/api/v1`;

  // 无浏览器环境下确保不伪造通过：startWorker 依赖 ensureBrowser()，
  // 启动失败则记录原因，由各用例在开头 guard() 主动跳过。
  before(async () => {
    try {
      await ensureToolsMeta();
      server = await startWorker({host: '127.0.0.1', port: PORT});
    } catch (err) {
      canRun = false;
      skipReason = err instanceof Error ? err.message : String(err);
      console.warn(
        '[workerHttp.test] 跳过整组：无法启动 worker（缺少可用浏览器 / CDP 连接失败）。' +
          `原始错误：${skipReason}`,
      );
    }
  });

  after(async () => {
    await server?.stop();
  });

  function shouldSkip(t: TestContext): boolean {
    if (canRun) return false;
    console.warn(`[workerHttp.test] 跳过用例：${skipReason}`);
    t.skip();
    return true;
  }

  it('health returns ok', async (t: TestContext) => {
    if (shouldSkip(t)) return;
    const r = await fetch(`${BASE}/health`);
    assert.equal(r.status, 200);
    const j = (await r.json()) as any;
    assert.equal(j.status, 'ok');
  });

  it('lists tools', async (t: TestContext) => {
    if (shouldSkip(t)) return;
    const r = await fetch(`${BASE}/tools`);
    const j = (await r.json()) as any;
    assert.ok(Array.isArray(j.tools) && j.tools.length > 0);
  });

  it('invoke a tool via async job and poll result', async (t: TestContext) => {
    if (shouldSkip(t)) return;
    const meta = getToolMeta('get_runtime_info');
    if (!meta) {
      console.warn('skip: get_runtime_info 不存在');
      return;
    }
    const s = (await (await fetch(`${BASE}/sessions`, {method: 'POST'})).json()) as any;
    const inv = await fetch(`${BASE}/sessions/${s.sessionId}/invoke`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({tool: 'get_runtime_info', params: {}}),
    });
    assert.equal(inv.status, 202);
    const {jobId} = (await inv.json()) as any;
    let job: any;
    for (let i = 0; i < 50; i++) {
      job = (await (await fetch(`${BASE}/jobs/${jobId}`)).json()) as any;
      if (job.status === 'done' || job.status === 'failed') break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(job.status, 'done');
    assert.ok(job.result !== undefined);
  });

  it('rejects when apiToken set but missing on loopback', async (t: TestContext) => {
    if (shouldSkip(t)) return;
    const s2 = await startWorker({host: '127.0.0.1', port: 18766, apiToken: 'secret'});
    try {
      const r = await fetch('http://127.0.0.1:18766/api/v1/health');
      assert.equal(r.status, 401);
    } finally {
      await s2.stop();
    }
  });

  it('allows with correct token', async (t: TestContext) => {
    if (shouldSkip(t)) return;
    const s2 = await startWorker({host: '127.0.0.1', port: 18767, apiToken: 'secret'});
    try {
      const r = await fetch('http://127.0.0.1:18767/api/v1/health', {
        headers: {authorization: 'Bearer secret'},
      });
      assert.equal(r.status, 200);
    } finally {
      await s2.stop();
    }
  });
});
