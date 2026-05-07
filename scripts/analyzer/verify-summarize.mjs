#!/usr/bin/env node

/**
 * verify-summarize.mjs — 验证 summarize_code 工具（single / batch / project 三种模式）
 *
 * 用法：
 *   node scripts/analyzer/verify-summarize.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000] [--mode single|batch|project|all]
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
  fetch('/api/order', { method: 'POST', headers: { 'X-Sign': sign }, body: JSON.stringify(data) });
}
`;

const BATCH_FILES = [
  { url: 'https://example.com/app.js', content: SAMPLE_CODE, size: SAMPLE_CODE.length, type: 'external' },
  { url: 'https://example.com/utils.js', content: 'function md5(str) { return crypto.createHash("md5").update(str).digest("hex"); }', size: 90, type: 'external' },
];

function parseArgs(argv) {
  const args = { rpcHost: 'ws://127.0.0.1:5612', group: 'js-reverse', timeout: 30000, mode: 'all' };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--rpcHost': args.rpcHost = argv[++i]; break;
      case '--group': args.group = argv[++i]; break;
      case '--timeout': args.timeout = Number(argv[++i]); break;
      case '--mode': args.mode = argv[++i]; break;
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

  console.log('\n🔍 summarize_code 验证');
  console.log(`   Sekiro: ${httpUrl}  Group: ${args.group}  Timeout: ${args.timeout}ms  Mode: ${args.mode}\n`);

  console.log('⏳ 检查 Sekiro Server...');
  try {
    const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok && resp.status !== 302) throw new Error(`HTTP ${resp.status}`);
  } catch {
    console.error(`❌ Sekiro Server 不可用: ${httpUrl}`);
    process.exit(1);
  }
  console.log('✓ Sekiro Server 可用\n');

  const tests = [];

  // 测试 1: single 模式
  if (args.mode === 'all' || args.mode === 'single') {
    console.log('⏳ 测试: mode=single...');
    const params = { mode: 'single', code: SAMPLE_CODE, url: 'https://example.com/app.js' };
    const start = Date.now();
    const result = await invokeTool(httpUrl, args.group, 'summarize_code', params, args.timeout);
    const duration = Date.now() - start;

    if (result.ok) {
      const data = result.data;
      const valid = data && (data.summary !== undefined || data.purpose !== undefined);
      console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration}ms)`);
      if (data.summary) console.log(`    summary: ${String(data.summary).slice(0, 80)}`);
      if (data.purpose) console.log(`    purpose: ${data.purpose}`);
      if (data.keyFunctions) console.log(`    keyFunctions: ${JSON.stringify(data.keyFunctions).slice(0, 100)}`);
      if (data.hasEncryption !== undefined) console.log(`    hasEncryption: ${data.hasEncryption}`);
      if (!valid) console.log(`    ⚠ 数据结构校验失败: 缺少 summary / purpose`);
      tests.push({ mode: 'single', ok: true, valid, duration });
    } else {
      console.log(`  ✗ 调用失败 (${duration}ms)  [${result.status}] ${result.error?.slice(0, 80)}`);
      tests.push({ mode: 'single', ok: false, valid: false, duration });
    }
  }

  // 测试 2: batch 模式
  if (args.mode === 'all' || args.mode === 'batch') {
    console.log('\n⏳ 测试: mode=batch...');
    const params = { mode: 'batch', files: BATCH_FILES };
    const start = Date.now();
    const result = await invokeTool(httpUrl, args.group, 'summarize_code', params, args.timeout);
    const duration = Date.now() - start;

    if (result.ok) {
      const data = result.data;
      const valid = Array.isArray(data);
      console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration}ms)`);
      if (valid) console.log(`    返回 ${data.length} 个文件摘要`);
      tests.push({ mode: 'batch', ok: true, valid, duration });
    } else {
      console.log(`  ✗ 调用失败 (${duration}ms)  [${result.status}] ${result.error?.slice(0, 80)}`);
      tests.push({ mode: 'batch', ok: false, valid: false, duration });
    }
  }

  // 测试 3: project 模式
  if (args.mode === 'all' || args.mode === 'project') {
    console.log('\n⏳ 测试: mode=project...');
    const params = { mode: 'project', files: BATCH_FILES };
    const start = Date.now();
    const result = await invokeTool(httpUrl, args.group, 'summarize_code', params, args.timeout);
    const duration = Date.now() - start;

    if (result.ok) {
      const data = result.data;
      const valid = data && (data.totalFiles !== undefined || data.mainPurpose !== undefined);
      console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration}ms)`);
      if (data.totalFiles !== undefined) console.log(`    totalFiles: ${data.totalFiles}`);
      if (data.mainPurpose) console.log(`    mainPurpose: ${data.mainPurpose}`);
      if (data.technologies) console.log(`    technologies: ${JSON.stringify(data.technologies).slice(0, 100)}`);
      tests.push({ mode: 'project', ok: true, valid, duration });
    } else {
      console.log(`  ✗ 调用失败 (${duration}ms)  [${result.status}] ${result.error?.slice(0, 80)}`);
      tests.push({ mode: 'project', ok: false, valid: false, duration });
    }
  }

  const passed = tests.some(t => t.valid);

  console.log('\n── 汇总 ──────────────────────────────────────────────');
  for (const t of tests) {
    const mark = t.valid ? '✓' : t.ok ? '⚠' : '✗';
    console.log(`  ${mark} mode=${t.mode.padEnd(10)} ${t.duration}ms`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(passed ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
