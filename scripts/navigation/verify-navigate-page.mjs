#!/usr/bin/env node

/**
 * verify-navigate-page.mjs — 单独验证 navigate_page 工具
 *
 * 用法：
 *   node scripts/navigation/verify-navigate-page.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 *
 * 流程：
 *   1. 检查 Sekiro Server 可用性
 *   2. 新建页面并导航到 example.com
 *   3. 测试 URL 导航到 httpbin.org
 *   4. 测试后退导航 (back)
 *   5. 测试前进导航 (forward)
 *   6. 测试刷新 (reload)
 *   7. 测试缺少 url 参数时的错误处理
 */

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

const TEST_CASES = [
  {
    name: 'URL 导航 → httpbin.org',
    params: { type: 'url', url: 'https://httpbin.org/get' },
    expectOk: true,
  },
  {
    name: '后退导航 (back)',
    params: { type: 'back' },
    expectOk: true,
  },
  {
    name: '前进导航 (forward)',
    params: { type: 'forward' },
    expectOk: true,
  },
  {
    name: '刷新页面 (reload)',
    params: { type: 'reload' },
    expectOk: true,
  },
  {
    name: '忽略缓存刷新 (reload + ignoreCache)',
    params: { type: 'reload', ignoreCache: true },
    expectOk: true,
  },
  {
    name: '缺少 url 参数时的错误处理',
    params: { type: 'url' },
    expectOk: false,
  },
];

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);

  let passCount = 0;
  let failCount = 0;

  console.log('\n🔍 navigate_page 单独验证');
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

  // 阶段 1: 创建初始页面
  console.log('⏳ 阶段 1: 创建初始页面 (example.com)...');
  const newPageResult = await invokeTool(httpUrl, args.group, 'new_page', {
    url: 'https://example.com',
    timeout: 10000,
  }, args.timeout);

  if (newPageResult.ok) {
    console.log('✓ 初始页面已创建');
  } else {
    console.log(`✗ 初始页面创建失败: ${newPageResult.error?.slice(0, 80) || newPageResult.status}`);
    console.log('\n❌ 无法创建初始页面，终止验证');
    process.exit(1);
  }

  // 等待页面稳定
  await new Promise(r => setTimeout(r, 2000));

  // 阶段 2: 逐一执行测试用例
  console.log('\n⏳ 阶段 2: 执行 navigate_page 测试用例...\n');

  for (const tc of TEST_CASES) {
    const start = Date.now();
    const result = await invokeTool(httpUrl, args.group, 'navigate_page', tc.params, args.timeout);
    const duration = Date.now() - start;

    const expectedMet = result.ok === tc.expectOk;
    const passed = expectedMet;

    if (passed) {
      passCount++;
      console.log(`  ✓ ${tc.name} (${duration}ms)`);
    } else {
      failCount++;
      console.log(`  ✗ ${tc.name} (${duration}ms)`);
      console.log(`    期望 ok=${tc.expectOk}，实际 ok=${result.ok}`);
    }

    if (result.ok) {
      console.log(`    返回: ${JSON.stringify(result.data).slice(0, 200)}`);
    } else {
      console.log(`    错误: ${result.error?.slice(0, 120)}`);
    }
    console.log('');

    // 测试间隔
    await new Promise(r => setTimeout(r, 1000));
  }

  const total = passCount + failCount;
  console.log('═══════════════════════════════════════════════════');
  console.log(`  通过: ${passCount}/${total}  失败: ${failCount}/${total}`);
  console.log(`  结果: ${failCount === 0 ? '✓ 全部通过' : '✗ 存在失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(2);
});
