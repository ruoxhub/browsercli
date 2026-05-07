#!/usr/bin/env node

/**
 * verify-remove-hook.mjs — 验证 remove_hook (RemoveHook) 工具
 *
 * 用法：
 *   node scripts/hook/verify-remove-hook.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 */

function parseArgs(argv) {
  const args = { rpcHost: 'ws://127.0.0.1:5612', group: 'js-reverse', timeout: 30000 };
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: 'http_error', httpStatus: response.status, error: await response.text().catch(() => '') };
    const result = await response.json();
    if (result.status === -1 || result.code === -1) return { ok: false, status: 'rpc_error', error: result.message || 'Sekiro action 执行失败', data: null };
    return { ok: true, status: 'ok', data: result.data ?? result };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, status: 'timeout', error: `超时 (${timeout}ms)` };
    return { ok: false, status: 'network_error', error: err.message };
  } finally { clearTimeout(timer); }
}

const TEST_CASES = [
  { name: '移除不存在的 hook（预期返回未找到）', params: { hookId: 'non-existent-hook-12345' }, expectOk: true },
  { name: '缺少 hookId', params: {}, expectOk: true },
  { name: '创建后移除 hook', params: { hookId: 'test-remove-hook' }, expectOk: true },
];

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);
  let passCount = 0;
  let failCount = 0;

  console.log('\n🔍 remove_hook (RemoveHook) 验证');
  console.log(`   Sekiro: ${httpUrl}  Group: ${args.group}  Timeout: ${args.timeout}ms\n`);

  console.log('⏳ 检查 Sekiro Server...');
  try {
    const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok && resp.status !== 302) throw new Error(`HTTP ${resp.status}`);
  } catch {
    console.error(`❌ Sekiro Server 不可用: ${httpUrl}`);
    process.exit(1);
  }
  console.log('✓ Sekiro Server 可用\n');

  console.log('⏳ 执行测试用例...\n');

  // 先创建一个 hook 用于后续移除测试
  const createResult = await invokeTool(httpUrl, args.group, 'create_hook', { type: 'fetch', hookId: 'test-remove-hook' }, args.timeout);
  if (createResult.ok) {
    console.log('  (预创建 test-remove-hook 成功)\n');
  }

  for (const tc of TEST_CASES) {
    const start = Date.now();
    const result = await invokeTool(httpUrl, args.group, 'remove_hook', tc.params, args.timeout);
    const duration = Date.now() - start;
    const passed = result.ok === tc.expectOk;
    if (passed) {
      passCount++;
      console.log(`  ✓ ${tc.name} (${duration}ms)`);
    } else {
      failCount++;
      console.log(`  ✗ ${tc.name} (${duration}ms)`);
      console.log(`    期望 ok=${tc.expectOk}，实际 ok=${result.ok}`);
    }
    if (result.ok) {
      const d = result.data;
      console.log(`    success=${d?.success}, hookId=${d?.data?.hookId || d?.hookId}`);
    } else {
      console.log(`    错误: ${result.error?.slice(0, 120)}`);
    }
    console.log('');
    await new Promise(r => setTimeout(r, 800));
  }

  const total = passCount + failCount;
  console.log('═══════════════════════════════════════════════════');
  console.log(`  通过: ${passCount}/${total}  失败: ${failCount}/${total}`);
  console.log(`  结果: ${failCount === 0 ? '✓ 全部通过' : '✗ 存在失败'}`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
