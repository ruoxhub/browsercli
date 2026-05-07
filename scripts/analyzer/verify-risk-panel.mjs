#!/usr/bin/env node

/**
 * verify-risk-panel.mjs — 验证 risk_panel 工具
 *
 * 用法：
 *   node scripts/analyzer/verify-risk-panel.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const HIGH_RISK_CODE = `
eval(atob('YWxlcnQoMSk='));
function generateSign(params, key) {
  return CryptoJS.MD5(Object.keys(params).join('') + key).toString();
}
function transmit(data) {
  fetch('/api/submit', { method: 'POST', body: JSON.stringify(data) });
}
`;

const LOW_RISK_CODE = `
function formatDate(date) {
  return date.toLocaleDateString();
}
function add(a, b) { return a + b; }
`;

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

  console.log('\n🔍 risk_panel 验证');
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

  // 测试 1: 高风险代码
  console.log('⏳ 测试 1: 高风险代码...');
  const start1 = Date.now();
  const result1 = await invokeTool(httpUrl, args.group, 'risk_panel', { code: HIGH_RISK_CODE, useAI: false, includeHookSignals: false }, args.timeout);
  const duration1 = Date.now() - start1;

  if (result1.ok) {
    const data = result1.data;
    const valid = data && typeof data.score === 'number' && ['high', 'medium', 'low'].includes(data.level);
    console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration1}ms)`);
    console.log(`    score: ${data?.score}`);
    console.log(`    level: ${data?.level}`);
    if (data?.factors) {
      console.log(`    factors.securityRisks: ${data.factors.securityRisks}`);
      console.log(`    factors.cryptoAlgorithms: ${data.factors.cryptoAlgorithms}`);
      console.log(`    factors.dangerousAlgorithms: ${JSON.stringify(data.factors.dangerousAlgorithms)}`);
    }
    if (data?.recommendations) console.log(`    recommendations: ${data.recommendations.length} 条`);
    if (!valid) console.log(`    ⚠ 数据结构校验失败: score 或 level 不符合预期`);
  } else {
    console.log(`  ✗ 调用失败 (${duration1}ms)  [${result1.status}] ${result1.error?.slice(0, 80)}`);
  }

  // 测试 2: 低风险代码
  console.log('\n⏳ 测试 2: 低风险代码...');
  const start2 = Date.now();
  const result2 = await invokeTool(httpUrl, args.group, 'risk_panel', { code: LOW_RISK_CODE, useAI: false, includeHookSignals: false }, args.timeout);
  const duration2 = Date.now() - start2;

  if (result2.ok) {
    const data = result2.data;
    const valid = data && typeof data.score === 'number';
    console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration2}ms)`);
    console.log(`    score: ${data?.score}  level: ${data?.level}`);
  } else {
    console.log(`  ✗ 调用失败 (${duration2}ms)  [${result2.status}] ${result2.error?.slice(0, 80)}`);
  }

  // 测试 3: 不传 code（依赖 collector）
  console.log('\n⏳ 测试 3: 不传 code（依赖已收集文件）...');
  const start3 = Date.now();
  const result3 = await invokeTool(httpUrl, args.group, 'risk_panel', { useAI: false, includeHookSignals: false, topN: 3 }, args.timeout);
  const duration3 = Date.now() - start3;

  if (result3.ok) {
    console.log(`  ✓ 调用成功 (${duration3}ms) — 有已收集文件`);
    console.log(`    score: ${result3.data?.score}  level: ${result3.data?.level}`);
  } else {
    console.log(`  ⚠ 调用失败 (${duration3}ms)  [${result3.status}] ${result3.error?.slice(0, 80)}`);
    console.log(`    (无已收集文件时失败可接受)`);
  }

  const passed = result1.ok && result1.data && typeof result1.data.score === 'number' && ['high', 'medium', 'low'].includes(result1.data.level);

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(passed ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
