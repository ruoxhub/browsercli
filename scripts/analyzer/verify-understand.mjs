#!/usr/bin/env node

/**
 * verify-understand.mjs — 验证 understand_code 工具
 *
 * 用法：
 *   node scripts/analyzer/verify-understand.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const SAMPLE_CODE = `
function generateSign(params, key) {
  var sorted = Object.keys(params).sort().map(function(k) { return k + '=' + params[k]; }).join('&');
  return CryptoJS.HmacMD5(sorted, key).toString();
}

function submitOrder(data) {
  var sign = generateSign(data, 'secret_key_123');
  fetch('/api/order', {
    method: 'POST',
    headers: { 'X-Sign': sign, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({}, data, { sign: sign }))
  });
}

function encryptPayload(plaintext, key) {
  var encrypted = CryptoJS.AES.encrypt(plaintext, key).toString();
  return encrypted;
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

  console.log('\n🔍 understand_code 验证');
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

  const focusModes = ['all', 'structure', 'business', 'security'];
  const results = [];

  for (const focus of focusModes) {
    console.log(`⏳ 测试: focus=${focus}...`);
    const start = Date.now();
    const result = await invokeTool(httpUrl, args.group, 'understand_code', { code: SAMPLE_CODE, focus }, args.timeout);
    const duration = Date.now() - start;

    if (result.ok) {
      const data = result.data;
      const hasQuality = data && data.qualityScore !== undefined;
      const hasSecurity = data && data.securityRisks !== undefined;
      const valid = hasQuality || hasSecurity;
      console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration}ms)`);
      if (hasQuality) console.log(`    qualityScore: ${data.qualityScore}`);
      if (hasSecurity) console.log(`    securityRisks: ${data.securityRisks?.length ?? 0} 项`);
      if (data.mainFunctions) console.log(`    mainFunctions: ${JSON.stringify(data.mainFunctions).slice(0, 100)}`);
      if (!valid) console.log(`    ⚠ 数据结构校验失败: 缺少 qualityScore / securityRisks`);
      results.push({ focus, ok: true, valid, duration });
    } else {
      console.log(`  ✗ 调用失败 (${duration}ms)  [${result.status}] ${result.error?.slice(0, 80)}`);
      results.push({ focus, ok: false, valid: false, duration });
    }
  }

  const passed = results.some(r => r.valid);

  console.log('\n── 汇总 ──────────────────────────────────────────────');
  for (const r of results) {
    const mark = r.valid ? '✓' : r.ok ? '⚠' : '✗';
    console.log(`  ${mark} focus=${r.focus.padEnd(12)} ${r.duration}ms`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(passed ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
