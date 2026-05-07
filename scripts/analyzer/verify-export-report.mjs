#!/usr/bin/env node

/**
 * verify-export-report.mjs — 验证 export_session_report 工具
 *
 * 用法：
 *   node scripts/analyzer/verify-export-report.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

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

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);

  console.log('\n🔍 export_session_report 验证');
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

  // 测试 1: JSON 格式
  console.log('⏳ 测试 1: JSON 格式导出...');
  const start1 = Date.now();
  const result1 = await invokeTool(httpUrl, args.group, 'export_session_report', { format: 'json', includeHookData: false }, args.timeout);
  const duration1 = Date.now() - start1;

  if (result1.ok) {
    const data = result1.data;
    const valid = data && data.generatedAt;
    console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration1}ms)`);
    console.log(`    generatedAt: ${data?.generatedAt}`);
    if (data?.collector) console.log(`    collector.totalFiles: ${data.collector.totalFiles}`);
    if (data?.hooks) console.log(`    hooks.totalRecords: ${data.hooks.totalRecords}`);
    if (data?.tokenBudget) console.log(`    tokenBudget: ${data.tokenBudget.usedTokens}/${data.tokenBudget.maxTokens} (${data.tokenBudget.usagePercent?.toFixed(2)}%)`);
    if (!valid) console.log(`    ⚠ 数据结构校验失败: 缺少 generatedAt`);
  } else {
    console.log(`  ✗ 调用失败 (${duration1}ms)  [${result1.status}] ${result1.error?.slice(0, 80)}`);
  }

  // 测试 2: Markdown 格式
  console.log('\n⏳ 测试 2: Markdown 格式导出...');
  const start2 = Date.now();
  const result2 = await invokeTool(httpUrl, args.group, 'export_session_report', { format: 'markdown', includeHookData: false }, args.timeout);
  const duration2 = Date.now() - start2;

  if (result2.ok) {
    const data = result2.data;
    const isMarkdown = typeof data === 'string' && data.includes('# Session Report');
    console.log(`  ${isMarkdown ? '✓' : '⚠'} 调用成功 (${duration2}ms)`);
    if (isMarkdown) {
      const preview = data.slice(0, 200).replace(/\n/g, '\\n');
      console.log(`    预览: ${preview}`);
    } else {
      console.log(`    返回类型: ${typeof data} (可能走 JSON 通道)`);
    }
  } else {
    console.log(`  ✗ 调用失败 (${duration2}ms)  [${result2.status}] ${result2.error?.slice(0, 80)}`);
  }

  // 测试 3: 含 Hook 数据
  console.log('\n⏳ 测试 3: 含 Hook 数据导出 (includeHookData=true)...');
  const start3 = Date.now();
  const result3 = await invokeTool(httpUrl, args.group, 'export_session_report', { format: 'json', includeHookData: true }, args.timeout);
  const duration3 = Date.now() - start3;

  if (result3.ok) {
    const data = result3.data;
    const valid = data && data.generatedAt;
    console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration3}ms)`);
    if (data?.hookData !== undefined) console.log(`    hookData: 已包含`);
    else console.log(`    hookData: 未包含`);
  } else {
    console.log(`  ✗ 调用失败 (${duration3}ms)  [${result3.status}] ${result3.error?.slice(0, 80)}`);
  }

  const passed = result1.ok && result1.data && result1.data.generatedAt;

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(passed ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
