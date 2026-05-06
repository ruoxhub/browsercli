#!/usr/bin/env node

/**
 * verify-list-pages.mjs — 单独验证 list_pages 工具
 *
 * 用法：
 *   node scripts/navigation/verify-list-pages.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 *
 * 流程：
 *   1. 检查 Sekiro Server 可用性
 *   2. 调用 list_pages 查看初始状态
 *   3. 新建页面后再调用 list_pages 验证页面数增加
 *   4. 验证选中标记是否正确
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

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);

  console.log('\n🔍 list_pages 单独验证');
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

  // 阶段 1: 初始页面列表
  console.log('⏳ 阶段 1: 获取初始页面列表...');
  const initialResult = await invokeTool(httpUrl, args.group, 'list_pages', {}, args.timeout);
  if (initialResult.ok) {
    console.log('✓ list_pages 调用成功');
    console.log(`  返回预览: ${JSON.stringify(initialResult.data).slice(0, 300)}`);
  } else {
    console.log(`✗ list_pages 调用失败: ${initialResult.error?.slice(0, 120)}`);
    console.log('\n❌ 基础调用失败，终止验证');
    process.exit(1);
  }

  // 阶段 2: 新建页面后再列出
  console.log('\n⏳ 阶段 2: 新建页面后验证列表变化...');
  const newPageResult = await invokeTool(httpUrl, args.group, 'new_page', {
    url: 'https://example.com',
    timeout: 10000,
  }, args.timeout);

  if (newPageResult.ok) {
    console.log('✓ 新页面已创建');
  } else {
    console.log(`⚠ 新页面创建失败: ${newPageResult.error?.slice(0, 80) || newPageResult.status}`);
  }

  // 等待页面稳定
  await new Promise(r => setTimeout(r, 1500));

  const afterResult = await invokeTool(httpUrl, args.group, 'list_pages', {}, args.timeout);
  if (afterResult.ok) {
    console.log('✓ 新建后 list_pages 调用成功');
    console.log(`  返回预览: ${JSON.stringify(afterResult.data).slice(0, 300)}`);
  } else {
    console.log(`✗ 新建后 list_pages 失败: ${afterResult.error?.slice(0, 80)}`);
  }

  // 阶段 3: 验证选中标记
  console.log('\n⏳ 阶段 3: 验证选中标记...');
  const raw = afterResult.data;
  const text = raw?.structuredContent?.data ?? raw?.text ?? String(raw);
  const hasSelectedMarker = typeof text === 'string' && text.includes('← 选中');
  if (hasSelectedMarker) {
    console.log('✓ 选中标记存在');
  } else {
    console.log('⚠ 未检测到选中标记（可能是格式变化）');
  }

  // 汇总
  console.log('\n═══════════════════════════════════════════════════');
  const passed = initialResult.ok && afterResult.ok;
  console.log(`  结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(2);
});
