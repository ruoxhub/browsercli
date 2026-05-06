#!/usr/bin/env node

/**
 * verify-trace-sig.mjs — 单独验证 trace_signature_generation 工具
 *
 * 用法：
 *   node scripts/verify-trace-sig.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 *
 * 流程：
 *   1. 打开测试页面
 *   2. 等待页面加载
 *   3. 调用 trace_signature_generation
 *   4. 输出详细结果
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    rpcHost: 'ws://127.0.0.1:5612',
    group: 'js-reverse',
    timeout: 30000,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--rpcHost': args.rpcHost = argv[++i]; break;
      case '--group': args.group = argv[++i]; break;
      case '--timeout': args.timeout = Number(argv[++i]); break;
    }
  }
  return args;
}

function toHttpUrl(wsUrl) {
  return wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
}

async function invokeTool(httpUrl, group, toolName, params, timeout) {
  const url = `${httpUrl}/business/invoke`;
  const body = { group, action: toolName, ...(Object.keys(params).length > 0 ? { params } : {}) };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, status: 'http_error', httpStatus: response.status, error: await response.text().catch(() => '') };
    }

    const result = await response.json();

    if (result.status === -1 || result.code === -1) {
      return { ok: false, status: 'rpc_error', error: result.message || 'Sekiro action 执行失败', data: null };
    }

    return { ok: true, status: 'ok', data: result.data ?? result };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, status: 'timeout', error: `超时 (${timeout}ms)` };
    }
    return { ok: false, status: 'network_error', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);

  console.log('\n🔍 trace_signature_generation 单独验证');
  console.log(`   Sekiro: ${httpUrl}  Group: ${args.group}  Timeout: ${args.timeout}ms\n`);

  // 检查 Sekiro 可用性
  console.log('⏳ 检查 Sekiro Server...');
  try {
    const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok && resp.status !== 302) throw new Error(`HTTP ${resp.status}`);
  } catch {
    console.error(`❌ Sekiro Server 不可用: ${httpUrl}`);
    process.exit(1);
  }
  console.log('✓ Sekiro Server 可用\n');

  // 阶段 1: 打开测试页面
  console.log('⏳ 阶段 1: 打开测试页面...');
  const newPageResult = await invokeTool(httpUrl, args.group, 'new_page', {
    url: 'https://example.com',
    timeout: 10000,
  }, args.timeout);
  if (newPageResult.ok) {
    console.log('✓ 测试页面已打开');
  } else {
    console.log(`⚠ 测试页面打开失败: ${newPageResult.error?.slice(0, 80) || newPageResult.status}`);
  }

  // 等待页面稳定
  await new Promise(r => setTimeout(r, 1000));

  // 阶段 2: 检查页面列表
  console.log('\n⏳ 阶段 2: 检查页面列表...');
  const listPagesResult = await invokeTool(httpUrl, args.group, 'list_pages', {}, args.timeout);
  if (listPagesResult.ok) {
    const pages = listPagesResult.data;
    console.log(`✓ 当前页面数: ${Array.isArray(pages) ? pages.length : '(未知)'}`);
    if (Array.isArray(pages) && pages.length > 0) {
      console.log(`  首页: ${JSON.stringify(pages[0]).slice(0, 120)}`);
    }
  } else {
    console.log(`⚠ list_pages 失败: ${listPagesResult.error?.slice(0, 60)}`);
  }

  // 阶段 3: 调用 trace_signature_generation
  console.log('\n⏳ 阶段 3: 调用 trace_signature_generation...');
  const params = {
    requestUrlPattern: '/api/',
    maxResults: 3,
  };
  const start = Date.now();
  const result = await invokeTool(httpUrl, args.group, 'trace_signature_generation', params, args.timeout);
  const duration = Date.now() - start;

  if (result.ok) {
    console.log(`✓ trace_signature_generation 成功 (${duration}ms)`);
    console.log(`  返回数据预览: ${JSON.stringify(result.data).slice(0, 300)}`);
  } else {
    console.log(`✗ trace_signature_generation 失败 (${duration}ms)`);
    console.log(`  状态: ${result.status}`);
    console.log(`  错误: ${result.error}`);
  }

  // 阶段 4: 无页面场景测试（可选）
  console.log('\n⏳ 阶段 4: 无页面场景测试...');
  // 不关闭页面，只是看看当前状态
  const noPageResult = await invokeTool(httpUrl, args.group, 'trace_signature_generation', params, args.timeout);
  if (noPageResult.ok) {
    console.log('✓ 有页面时正常返回');
  } else {
    console.log(`⚠ 有页面时仍失败: ${noPageResult.error?.slice(0, 80)}`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${result.ok ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(result.ok ? 0 : 1);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(2);
});
