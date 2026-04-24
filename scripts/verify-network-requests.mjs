#!/usr/bin/env node
/**
 * verify-network-requests.mjs — 验证 list_network_requests 工具
 *
 * 用法：
 *   node scripts/verify-network-requests.mjs [--sekiroHost ws://127.0.0.1:5612] [--group js-reverse]
 *
 * 前提：Sekiro Server 和 Worker 均已运行（js-reverse start）
 */

import { readFileSync } from 'node:fs';

// ─── 参数解析 ───────────────────────────────────────────

function parseArgs(argv) {
  const args = { sekiroHost: 'ws://127.0.0.1:5612', group: 'js-reverse', timeout: 30000 };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--sekiroHost': args.sekiroHost = argv[++i]; break;
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
      return { ok: false, status: 'sekiro_error', error: result.message || 'Sekiro action 执行失败', data: null };
    }

    return { ok: true, status: 'success', data: result };
  } catch (error) {
    return { ok: false, status: 'exception', error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function printResult(label, result) {
  console.log(`\n━━━ ${label} ━━━`);
  if (!result.ok) {
    console.log(`❌ 失败: ${result.status}`);
    console.log(`   错误: ${result.error}`);
    return;
  }
  console.log(`✅ 成功`);
  console.log(`   完整结果:`, JSON.stringify(result.data, null, 2));
}

// ─── 主流程 ─────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.sekiroHost);

  console.log(`🚀 验证网络请求工具`);
  console.log(`   Sekiro HTTP: ${httpUrl}`);
  console.log(`   Group: ${args.group}`);

  // 1. 创建新页面并导航到百度
  console.log(`\n📄 Step 1: 创建新页面并导航到 https://www.baidu.com`);
  const newPageResult = await invokeTool(httpUrl, args.group, 'new_page', { url: 'https://www.baidu.com' }, args.timeout);
  printResult('new_page', newPageResult);

  if (!newPageResult.ok) {
    console.log('\n❌ new_page 失败，终止验证');
    process.exit(1);
  }

  // 等待页面加载完成
  console.log('\n⏳ 等待 3 秒让页面完成加载...');
  await new Promise(r => setTimeout(r, 3000));

  // 1.5 列出页面确认选中状态
  console.log('\n📄 Step 1.5: 列出页面确认状态');
  const listPagesResult = await invokeTool(httpUrl, args.group, 'list_pages', {}, args.timeout);
  printResult('list_pages', listPagesResult);

  // 2. 列出网络请求
  console.log('\n📡 Step 2: 列出网络请求');
  const listResult = await invokeTool(httpUrl, args.group, 'list_network_requests', {}, args.timeout);
  printResult('list_network_requests', listResult);

  // 2.5 尝试包含保留请求
  console.log('\n📡 Step 2.5: 列出网络请求（包含保留请求）');
  const listPreservedResult = await invokeTool(httpUrl, args.group, 'list_network_requests', { includePreservedRequests: true }, args.timeout);
  printResult('list_network_requests (preserved)', listPreservedResult);

  // 3. 验证结果
  console.log('\n━━━ 验证总结 ━━━');
  const listData = listResult.data?.data?.structuredContent?.data;
  const preservedData = listPreservedResult.data?.data?.structuredContent?.data;

  console.log(`   当前导航请求数: ${listData?.total ?? 'N/A'}`);
  console.log(`   保留请求数: ${preservedData?.total ?? 'N/A'}`);
  console.log(`   选中页面索引: ${listPagesResult.data?.data?.structuredContent?.data?.selectedIndex ?? 'N/A'}`);
  console.log(`   新页面索引: ${newPageResult.data?.data?.structuredContent?.data?.index ?? 'N/A'}`);

  if (listResult.ok && (listData?.total > 0 || preservedData?.total > 0)) {
    console.log(`✅ list_network_requests 正常工作`);
    process.exit(0);
  } else if (listResult.ok) {
    console.log(`⚠️ list_network_requests 返回成功但请求数为 0`);
    process.exit(1);
  } else {
    console.log(`❌ list_network_requests 失败: ${listResult.error}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('验证脚本异常:', err);
  process.exit(1);
});
