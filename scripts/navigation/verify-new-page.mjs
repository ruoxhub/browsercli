#!/usr/bin/env node

/**
 * verify-new-page.mjs — 单独验证 new_page 工具
 *
 * 用法：
 *   node scripts/navigation/verify-new-page.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 *
 * 流程：
 *   1. 检查 Sekiro Server 可用性
 *   2. 调用 new_page 创建页面（example.com）
 *   3. 调用 list_pages 验证新页面出现在列表且已选中
 *   4. 再次 new_page 创建第二个页面，验证多页面场景
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

  console.log('\n🔍 new_page 单独验证');
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

  // 阶段 1: 创建第一个页面
  console.log('⏳ 阶段 1: 创建新页面 (example.com)...');
  const start1 = Date.now();
  const result1 = await invokeTool(httpUrl, args.group, 'new_page', {
    url: 'https://example.com',
    timeout: 10000,
  }, args.timeout);
  const duration1 = Date.now() - start1;

  if (result1.ok) {
    passCount++;
    console.log(`✓ 第一个 new_page 成功 (${duration1}ms)`);
    console.log(`  返回预览: ${JSON.stringify(result1.data).slice(0, 300)}`);
  } else {
    failCount++;
    console.log(`✗ 第一个 new_page 失败 (${duration1}ms) [${result1.status}]`);
    console.log(`  错误: ${result1.error?.slice(0, 120)}`);
  }

  // 等待页面稳定
  await new Promise(r => setTimeout(r, 1500));

  // 阶段 2: 验证新页面出现在列表且已选中
  console.log('\n⏳ 阶段 2: 验证新页面已选中...');
  const listResult1 = await invokeTool(httpUrl, args.group, 'list_pages', {}, args.timeout);
  if (listResult1.ok) {
    const raw = listResult1.data;
    const text = raw?.structuredContent?.data ?? raw?.text ?? String(raw);
    const hasSelected = typeof text === 'string' && text.includes('← 选中');
    if (hasSelected) {
      passCount++;
      console.log('✓ 新页面已被标记为选中');
    } else {
      failCount++;
      console.log('✗ 未检测到选中标记');
    }
    console.log(`  list_pages 预览: ${JSON.stringify(listResult1.data).slice(0, 300)}`);
  } else {
    failCount++;
    console.log(`✗ list_pages 失败: ${listResult1.error?.slice(0, 80)}`);
  }

  // 阶段 3: 创建第二个页面
  console.log('\n⏳ 阶段 3: 创建第二个新页面 (httpbin)...');
  const start3 = Date.now();
  const result2 = await invokeTool(httpUrl, args.group, 'new_page', {
    url: 'https://httpbin.org/get',
    timeout: 15000,
  }, args.timeout);
  const duration3 = Date.now() - start3;

  if (result2.ok) {
    passCount++;
    console.log(`✓ 第二个 new_page 成功 (${duration3}ms)`);
    console.log(`  返回预览: ${JSON.stringify(result2.data).slice(0, 300)}`);
  } else {
    failCount++;
    console.log(`✗ 第二个 new_page 失败 (${duration3}ms) [${result2.status}]`);
    console.log(`  错误: ${result2.error?.slice(0, 120)}`);
  }

  // 阶段 4: 验证多页面列表
  await new Promise(r => setTimeout(r, 1500));
  console.log('\n⏳ 阶段 4: 验证多页面列表...');
  const listResult2 = await invokeTool(httpUrl, args.group, 'list_pages', {}, args.timeout);
  if (listResult2.ok) {
    const raw = listResult2.data;
    const text = raw?.structuredContent?.data ?? raw?.text ?? String(raw);
    // 检查是否包含两个 URL
    const hasExample = text.includes('example.com');
    const hasHttpbin = text.includes('httpbin');
    if (hasExample && hasHttpbin) {
      passCount++;
      console.log('✓ 列表中包含两个页面');
    } else {
      failCount++;
      console.log(`⚠ 列表中可能缺少页面: example=${hasExample} httpbin=${hasHttpbin}`);
    }
    console.log(`  list_pages 预览: ${JSON.stringify(listResult2.data).slice(0, 400)}`);
  } else {
    failCount++;
    console.log(`✗ list_pages 失败: ${listResult2.error?.slice(0, 80)}`);
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
