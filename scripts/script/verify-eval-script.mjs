#!/usr/bin/env node

/**
 * verify-eval-script.mjs — 单独验证 evaluate_script 工具
 *
 * 用法：
 *   node scripts/verify-eval-script.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 *
 * 流程：
 *   1. 打开测试页面
 *   2. 等待页面加载
 *   3. 依次调用 evaluate_script 的多种参数组合
 *   4. 输出详细结果和耗时
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

// 测试用例
const TEST_CASES = [
  {
    name: '简单表达式 (page context)',
    params: {
      function: '() => document.title',
      context: 'page',
      verbose: false,
    },
  },
  {
    name: '简单表达式 (utility context)',
    params: {
      function: '() => 1 + 1',
      context: 'utility',
      verbose: false,
    },
  },
  {
    name: '返回 JSON 对象',
    params: {
      function: '() => ({ url: location.href, title: document.title })',
      context: 'page',
      verbose: false,
    },
  },
  {
    name: 'verbose 模式',
    params: {
      function: '() => "hello"',
      context: 'page',
      verbose: true,
    },
  },
];

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);

  console.log('\n🔍 evaluate_script 单独验证');
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
  await new Promise(r => setTimeout(r, 1500));

  // 阶段 2: 检查页面列表
  console.log('\n⏳ 阶段 2: 检查页面列表...');
  const listPagesResult = await invokeTool(httpUrl, args.group, 'list_pages', {}, args.timeout);
  if (listPagesResult.ok) {
    const pages = listPagesResult.data;
    console.log(`✓ 当前页面数: ${Array.isArray(pages) ? pages.length : '(未知)'}`);
  } else {
    console.log(`⚠ list_pages 失败: ${listPagesResult.error?.slice(0, 60)}`);
  }

  // 阶段 3: 逐一执行测试用例
  console.log('\n⏳ 阶段 3: 执行 evaluate_script 测试用例...\n');

  let passCount = 0;
  let failCount = 0;

  for (const tc of TEST_CASES) {
    const start = Date.now();
    const result = await invokeTool(httpUrl, args.group, 'evaluate_script', tc.params, args.timeout);
    const duration = Date.now() - start;

    if (result.ok) {
      passCount++;
      console.log(`  ✓ ${tc.name} (${duration}ms)`);
      const preview = JSON.stringify(result.data).slice(0, 200);
      console.log(`    返回: ${preview}`);
    } else {
      failCount++;
      console.log(`  ✗ ${tc.name} (${duration}ms) [${result.status}]`);
      console.log(`    错误: ${result.error?.slice(0, 120)}`);
    }
    console.log('');

    // 测试间隔，避免 CDP 会话竞争
    await new Promise(r => setTimeout(r, 500));
  }

  // 汇总
  console.log('═══════════════════════════════════════════════════');
  console.log(`  通过: ${passCount}/${TEST_CASES.length}  失败: ${failCount}/${TEST_CASES.length}`);
  console.log(`  结果: ${failCount === 0 ? '✓ 全部通过' : '✗ 存在失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(2);
});
