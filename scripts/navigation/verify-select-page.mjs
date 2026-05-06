#!/usr/bin/env node

/**
 * verify-select-page.mjs — 单独验证 select_page 工具
 *
 * 用法：
 *   node scripts/navigation/verify-select-page.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 *
 * 流程：
 *   1. 检查 Sekiro Server 可用性
 *   2. 创建两个页面（example.com 和 httpbin.org）
 *   3. 使用 list_pages 获取页面索引
 *   4. 使用 select_page 切换到第一个页面
 *   5. 验证 list_pages 中选中标记已变更
 *   6. 使用 select_page 切换回第二个页面
 *   7. 测试无效索引的错误处理
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

  let passCount = 0;
  let failCount = 0;

  console.log('\n🔍 select_page 单独验证');
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

  // 阶段 1: 创建两个页面
  console.log('⏳ 阶段 1: 创建两个测试页面...');

  const page1Result = await invokeTool(httpUrl, args.group, 'new_page', {
    url: 'https://example.com',
    timeout: 10000,
  }, args.timeout);

  if (page1Result.ok) {
    console.log('✓ 页面 1 (example.com) 已创建');
  } else {
    console.log(`✗ 页面 1 创建失败: ${page1Result.error?.slice(0, 80) || page1Result.status}`);
    console.log('\n❌ 无法创建页面，终止验证');
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, 1500));

  const page2Result = await invokeTool(httpUrl, args.group, 'new_page', {
    url: 'https://httpbin.org/get',
    timeout: 15000,
  }, args.timeout);

  if (page2Result.ok) {
    console.log('✓ 页面 2 (httpbin.org) 已创建');
  } else {
    console.log(`⚠ 页面 2 创建失败: ${page2Result.error?.slice(0, 80) || page2Result.status}`);
  }

  await new Promise(r => setTimeout(r, 1500));

  // 阶段 2: 查看当前页面列表
  console.log('\n⏳ 阶段 2: 查看当前页面列表...');
  const listBefore = await invokeTool(httpUrl, args.group, 'list_pages', {}, args.timeout);
  if (listBefore.ok) {
    const raw = listBefore.data;
    const text = raw?.structuredContent?.data ?? raw?.text ?? String(raw);
    console.log(`  list_pages 预览: ${JSON.stringify(listBefore.data).slice(0, 400)}`);
  } else {
    console.log(`✗ list_pages 失败: ${listBefore.error?.slice(0, 80)}`);
  }

  // 阶段 3: 切换到页面索引 0 (example.com)
  console.log('\n⏳ 阶段 3: select_page → 索引 0...');
  const start3 = Date.now();
  const selectResult1 = await invokeTool(httpUrl, args.group, 'select_page', {
    pageIdx: 0,
  }, args.timeout);
  const duration3 = Date.now() - start3;

  if (selectResult1.ok) {
    passCount++;
    console.log(`✓ select_page(0) 成功 (${duration3}ms)`);
    console.log(`  返回: ${JSON.stringify(selectResult1.data).slice(0, 300)}`);
  } else {
    failCount++;
    console.log(`✗ select_page(0) 失败 (${duration3}ms) [${selectResult1.status}]`);
    console.log(`  错误: ${selectResult1.error?.slice(0, 120)}`);
  }

  await new Promise(r => setTimeout(r, 500));

  // 验证选中标记
  console.log('\n⏳ 验证选中标记已变更...');
  const listAfter1 = await invokeTool(httpUrl, args.group, 'list_pages', {}, args.timeout);
  if (listAfter1.ok) {
    const raw = listAfter1.data;
    const text = raw?.structuredContent?.data ?? raw?.text ?? String(raw);
    // 索引 0 应该是选中的
    const lines = text.split('\n');
    const line0 = lines.find(l => l.startsWith('[0]'));
    if (line0 && line0.includes('← 选中')) {
      passCount++;
      console.log('✓ 索引 0 已被标记为选中');
    } else {
      failCount++;
      console.log('✗ 索引 0 未被标记为选中');
      console.log(`  [0] 行内容: ${line0 || '(未找到)'}`);
    }
  } else {
    failCount++;
    console.log(`✗ list_pages 验证失败: ${listAfter1.error?.slice(0, 80)}`);
  }

  // 阶段 4: 切换到页面索引 1 (httpbin.org)
  console.log('\n⏳ 阶段 4: select_page → 索引 1...');
  const start4 = Date.now();
  const selectResult2 = await invokeTool(httpUrl, args.group, 'select_page', {
    pageIdx: 1,
  }, args.timeout);
  const duration4 = Date.now() - start4;

  if (selectResult2.ok) {
    passCount++;
    console.log(`✓ select_page(1) 成功 (${duration4}ms)`);
    console.log(`  返回: ${JSON.stringify(selectResult2.data).slice(0, 300)}`);
  } else {
    failCount++;
    console.log(`✗ select_page(1) 失败 (${duration4}ms) [${selectResult2.status}]`);
    console.log(`  错误: ${selectResult2.error?.slice(0, 120)}`);
  }

  await new Promise(r => setTimeout(r, 500));

  // 阶段 5: 测试无效索引
  console.log('\n⏳ 阶段 5: 测试无效索引 (pageIdx=999)...');
  const invalidResult = await invokeTool(httpUrl, args.group, 'select_page', {
    pageIdx: 999,
  }, args.timeout);

  if (!invalidResult.ok) {
    passCount++;
    console.log('✓ 无效索引正确返回错误');
    console.log(`  错误信息: ${invalidResult.error?.slice(0, 120)}`);
  } else {
    failCount++;
    console.log('✗ 无效索引未返回错误');
    console.log(`  返回: ${JSON.stringify(invalidResult.data).slice(0, 200)}`);
  }

  const total = passCount + failCount;
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  通过: ${passCount}/${total}  失败: ${failCount}/${total}`);
  console.log(`  结果: ${failCount === 0 ? '✓ 全部通过' : '✗ 存在失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(2);
});
