#!/usr/bin/env node

/**
 * verify-record-evidence.mjs — 验证 record_reverse_evidence 工具
 *
 * 用法：
 *   node scripts/analyzer/verify-record-evidence.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
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

  console.log('\n🔍 record_reverse_evidence 验证');
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

  const TIMESTAMP = Date.now();

  // 测试 1: 基础证据记录
  console.log('⏳ 测试 1: 基础证据记录...');
  const params1 = {
    taskId: `verify-evidence-${TIMESTAMP}`,
    taskSlug: 'verify-evidence',
    targetUrl: 'https://example.com',
    goal: 'Automated evidence recording verification',
    channel: 'runtime-evidence',
    entry: {
      type: 'crypto-finding',
      description: 'HmacMD5 signature detected in generateSign function',
      severity: 'medium',
    },
  };
  const start1 = Date.now();
  const result1 = await invokeTool(httpUrl, args.group, 'record_reverse_evidence', params1, args.timeout);
  const duration1 = Date.now() - start1;

  if (result1.ok) {
    const data = result1.data;
    const valid = data && data.ok === true && data.taskId;
    console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration1}ms)`);
    console.log(`    ok: ${data?.ok}`);
    console.log(`    taskId: ${data?.taskId}`);
    console.log(`    taskDir: ${data?.taskDir}`);
    console.log(`    channel: ${data?.channel}`);
    if (data?.mirroredChannels) console.log(`    mirroredChannels: ${JSON.stringify(data.mirroredChannels)}`);
    if (!valid) console.log(`    ⚠ 数据结构校验失败: 缺少 ok 或 taskId`);
  } else {
    console.log(`  ✗ 调用失败 (${duration1}ms)  [${result1.status}] ${result1.error?.slice(0, 80)}`);
  }

  // 测试 2: 含 targetContext 的证据记录
  console.log('\n⏳ 测试 2: 含 targetContext 证据记录...');
  const params2 = {
    taskId: `verify-evidence-${TIMESTAMP}`,
    taskSlug: 'verify-evidence',
    targetUrl: 'https://example.com/api',
    goal: 'Verify target context recording',
    channel: 'runtime-evidence',
    targetKeywords: ['sign', 'token', 'encrypt'],
    targetUrlPatterns: ['/api/'],
    targetFunctionNames: ['generateSign', 'encryptPayload'],
    targetActionDescription: 'Login signature generation flow',
    entry: {
      type: 'signature-chain',
      description: 'Found signature generation in login endpoint',
      functionName: 'generateSign',
      algorithm: 'HmacMD5',
    },
  };
  const start2 = Date.now();
  const result2 = await invokeTool(httpUrl, args.group, 'record_reverse_evidence', params2, args.timeout);
  const duration2 = Date.now() - start2;

  if (result2.ok) {
    const data = result2.data;
    const valid = data && data.ok === true && data.targetContext;
    console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration2}ms)`);
    if (data?.targetContext) {
      console.log(`    targetContext.targetKeywords: ${JSON.stringify(data.targetContext.targetKeywords)}`);
      console.log(`    targetContext.targetFunctionNames: ${JSON.stringify(data.targetContext.targetFunctionNames)}`);
    }
    if (!valid) console.log(`    ⚠ 数据结构校验失败: 缺少 targetContext`);
  } else {
    console.log(`  ✗ 调用失败 (${duration2}ms)  [${result2.status}] ${result2.error?.slice(0, 80)}`);
  }

  // 测试 3: 自定义 channel
  console.log('\n⏳ 测试 3: 自定义 channel...');
  const params3 = {
    taskId: `verify-evidence-${TIMESTAMP}`,
    taskSlug: 'verify-evidence',
    targetUrl: 'https://example.com',
    goal: 'Test custom channel',
    channel: 'custom-analysis',
    entry: { type: 'note', text: 'Custom channel test entry' },
  };
  const start3 = Date.now();
  const result3 = await invokeTool(httpUrl, args.group, 'record_reverse_evidence', params3, args.timeout);
  const duration3 = Date.now() - start3;

  if (result3.ok) {
    const data = result3.data;
    console.log(`  ✓ 调用成功 (${duration3}ms)`);
    console.log(`    channel: ${data?.channel}`);
    console.log(`    mirroredChannels: ${JSON.stringify(data?.mirroredChannels ?? [])}`);
  } else {
    console.log(`  ✗ 调用失败 (${duration3}ms)  [${result3.status}] ${result3.error?.slice(0, 80)}`);
  }

  const passed = result1.ok && result1.data && result1.data.ok === true && result1.data.taskId;

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(passed ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
