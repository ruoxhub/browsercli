#!/usr/bin/env node

/**
 * verify-detect-crypto.mjs — 验证 detect_crypto 工具
 *
 * 用法：
 *   node scripts/analyzer/verify-detect-crypto.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const CODE_WITH_CRYPTO = `
var CryptoJS = require('crypto-js');
function encrypt(text, key) {
  return CryptoJS.AES.encrypt(text, key).toString();
}
function decrypt(cipher, key) {
  return CryptoJS.AES.decrypt(cipher, key).toString(CryptoJS.enc.Utf8);
}
function sign(params) {
  var str = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
  return CryptoJS.HmacMD5(str, 'secret').toString();
}
function hashPassword(pwd) {
  return CryptoJS.MD5(pwd).toString();
}
function legacyEncrypt(text) {
  return CryptoJS.DES.encrypt(text, 'key123').toString();
}
`;

const CODE_NO_CRYPTO = `
function add(a, b) { return a + b; }
function greet(name) { return 'Hello, ' + name; }
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

  console.log('\n🔍 detect_crypto 验证');
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

  // 测试 1: 含加密代码
  console.log('⏳ 测试 1: 含加密算法代码...');
  const start1 = Date.now();
  const result1 = await invokeTool(httpUrl, args.group, 'detect_crypto', { code: CODE_WITH_CRYPTO, useAI: false }, args.timeout);
  const duration1 = Date.now() - start1;

  if (result1.ok) {
    const data = result1.data;
    const valid = data && Array.isArray(data.algorithms);
    console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration1}ms)`);
    if (data.algorithms) console.log(`    algorithms: ${JSON.stringify(data.algorithms.map(a => a.name || a))}`);
    if (data.libraries) console.log(`    libraries: ${JSON.stringify(data.libraries.map(l => l.name || l))}`);
    if (data.confidence !== undefined) console.log(`    confidence: ${data.confidence}`);
    if (data.securityIssues) console.log(`    securityIssues: ${data.securityIssues.length} 项`);
    if (!valid) console.log(`    ⚠ 数据结构校验失败: 缺少 algorithms`);
  } else {
    console.log(`  ✗ 调用失败 (${duration1}ms)  [${result1.status}] ${result1.error?.slice(0, 80)}`);
  }

  // 测试 2: 无加密代码
  console.log('\n⏳ 测试 2: 无加密算法代码...');
  const start2 = Date.now();
  const result2 = await invokeTool(httpUrl, args.group, 'detect_crypto', { code: CODE_NO_CRYPTO, useAI: false }, args.timeout);
  const duration2 = Date.now() - start2;

  if (result2.ok) {
    const data = result2.data;
    const valid = data && Array.isArray(data.algorithms);
    console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration2}ms)`);
    console.log(`    algorithms: ${data?.algorithms?.length ?? 0} 个`);
    console.log(`    confidence: ${data?.confidence ?? '(缺失)'}`);
    tests2Ok = valid;
  } else {
    console.log(`  ✗ 调用失败 (${duration2}ms)  [${result2.status}] ${result2.error?.slice(0, 80)}`);
  }

  // 测试 3: 空 code
  console.log('\n⏳ 测试 3: 空代码边界测试...');
  const start3 = Date.now();
  const result3 = await invokeTool(httpUrl, args.group, 'detect_crypto', { code: '', useAI: false }, args.timeout);
  const duration3 = Date.now() - start3;

  if (result3.ok) {
    console.log(`  ✓ 调用成功 (${duration3}ms) — 空输入未崩溃`);
  } else {
    console.log(`  ⚠ 调用失败 (${duration3}ms)  [${result3.status}] ${result3.error?.slice(0, 80)}`);
  }

  const passed = result1.ok && result1.data && Array.isArray(result1.data.algorithms);

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(passed ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
