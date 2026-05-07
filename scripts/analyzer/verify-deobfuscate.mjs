#!/usr/bin/env node

/**
 * verify-deobfuscate.mjs — 验证 deobfuscate_code 工具
 *
 * 用法：
 *   node scripts/analyzer/verify-deobfuscate.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const SAMPLE_CODE = `
var _0x1a2b = ['log', 'Hello', 'encrypt', 'AES'];
(function(_0x3c4d5e, _0x1a2b3c) {
  var _0x4d5e6f = function(_0x5f6g7h) {
    while (--_0x5f6g7h) { _0x3c4d5e['push'](_0x3c4d5e['shift']()); }
  };
  _0x4d5e6f(++_0x1a2b3c);
})(_0x1a2b, 0x1a2);
function generateSign(params, key) {
  var sorted = Object.keys(params).sort().map(function(k) { return k + '=' + params[k]; }).join('&');
  return CryptoJS.HmacMD5(sorted, key).toString();
}
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
    if (err.name === 'AbortError') return { ok: false, status: 'timeout', error: `超时 (${timeout}ms)` };
    return { ok: false, status: 'network_error', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);

  console.log('\n🔍 deobfuscate_code 验证');
  console.log(`   Sekiro: ${httpUrl}  Group: ${args.group}  Timeout: ${args.timeout}ms\n`);

  // 检查 Sekiro
  console.log('⏳ 检查 Sekiro Server...');
  try {
    const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok && resp.status !== 302) throw new Error(`HTTP ${resp.status}`);
  } catch {
    console.error(`❌ Sekiro Server 不可用: ${httpUrl}`);
    process.exit(1);
  }
  console.log('✓ Sekiro Server 可用\n');

  // 测试 1: 基础去混淆
  console.log('⏳ 测试 1: 基础去混淆 (aggressive=true, renameVariables=true)...');
  const params1 = { code: SAMPLE_CODE, aggressive: true, renameVariables: true };
  const start1 = Date.now();
  const result1 = await invokeTool(httpUrl, args.group, 'deobfuscate_code', params1, args.timeout);
  const duration1 = Date.now() - start1;

  if (result1.ok) {
    const data = result1.data;
    const hasConfidence = data && typeof data.confidence === 'number';
    console.log(`  ${hasConfidence ? '✓' : '✗'} 调用成功 (${duration1}ms)`);
    console.log(`    confidence: ${data?.confidence ?? '(缺失)'}`);
    console.log(`    readabilityScore: ${data?.readabilityScore ?? '(缺失)'}`);
    console.log(`    transformations: ${data?.transformations?.length ?? '(缺失)'}`);
    if (!hasConfidence) {
      console.log(`    ⚠ 数据结构校验失败: 缺少 confidence 字段`);
    }
  } else {
    console.log(`  ✗ 调用失败 (${duration1}ms)  [${result1.status}] ${result1.error?.slice(0, 80)}`);
  }

  // 测试 2: 非激进模式
  console.log('\n⏳ 测试 2: 非激进模式 (aggressive=false)...');
  const params2 = { code: SAMPLE_CODE, aggressive: false };
  const start2 = Date.now();
  const result2 = await invokeTool(httpUrl, args.group, 'deobfuscate_code', params2, args.timeout);
  const duration2 = Date.now() - start2;

  if (result2.ok) {
    console.log(`  ✓ 调用成功 (${duration2}ms)`);
    console.log(`    confidence: ${result2.data?.confidence ?? '(缺失)'}`);
  } else {
    console.log(`  ✗ 调用失败 (${duration2}ms)  [${result2.status}] ${result2.error?.slice(0, 80)}`);
  }

  // 测试 3: 空代码
  console.log('\n⏳ 测试 3: 空代码边界测试...');
  const params3 = { code: '' };
  const start3 = Date.now();
  const result3 = await invokeTool(httpUrl, args.group, 'deobfuscate_code', params3, args.timeout);
  const duration3 = Date.now() - start3;

  if (result3.ok) {
    console.log(`  ✓ 调用成功 (${duration3}ms) — 空输入未崩溃`);
  } else {
    console.log(`  ⚠ 调用失败 (${duration3}ms)  [${result3.status}] ${result3.error?.slice(0, 80)}`);
    console.log(`    (空输入失败可接受，非阻断性)`);
  }

  const passed = result1.ok && result1.data && typeof result1.data.confidence === 'number';

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(passed ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
