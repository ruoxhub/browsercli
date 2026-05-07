#!/usr/bin/env node

/**
 * verify-analyze-target.mjs — 验证 analyze_target 工具
 *
 * 这是最重量级的 analyzer 工具，集成了 collect、understand、detect_crypto、
 * deobfuscation、hook timeline correlation 等多个子流程。
 *
 * 用法：
 *   node scripts/analyzer/verify-analyze-target.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 60000]
 *
 * 前提：需要浏览器页面上下文
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { rpcHost: 'ws://127.0.0.1:5612', group: 'js-reverse', timeout: 60000 };
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

  console.log('\n🔍 analyze_target 验证');
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

  // 阶段 1: 打开测试页面
  console.log('⏳ 阶段 1: 打开测试页面...');
  const newPageResult = await invokeTool(httpUrl, args.group, 'new_page', {
    url: 'https://qiye.qizhidao.com/',
    timeout: 10000,
  }, args.timeout);

  if (newPageResult.ok) {
    console.log('✓ 测试页面已打开\n');
  } else {
    console.log(`⚠ 测试页面打开失败: ${newPageResult.error?.slice(0, 60) || newPageResult.status}`);
    console.log('  尝试使用 navigate_page...\n');
    const navResult = await invokeTool(httpUrl, args.group, 'navigate_page', {
      type: 'goto', url: 'https://qiye.qizhidao.com/', timeout: 10000,
    }, args.timeout);
    if (!navResult.ok) {
      console.log(`⚠ navigate_page 也失败，analyze_target 可能失败\n`);
    }
  }

  // 等待页面稳定
  await new Promise(r => setTimeout(r, 1500));

  // 测试 1: 轻量模式（无 AI、无去混淆、无 hook 注入）
  console.log('⏳ 测试 1: 轻量模式 (useAI=true, runDeobfuscation=true, hookPreset=none)...');
  const params1 = {
    url: 'https://qiye.qizhidao.com/',
    topN: 3,
    useAI: true,
    runDeobfuscation: true,
    hookPreset: 'none',
    autoInjectHooks: true,
  };
  const start1 = Date.now();
  const result1 = await invokeTool(httpUrl, args.group, 'analyze_target', params1, args.timeout);
  const duration1 = Date.now() - start1;

  if (result1.ok) {
    const data = result1.data;
    const valid = data && data.target && typeof data.durationMs === 'number';
    console.log(`  ${valid ? '✓' : '✗'} 调用成功 (${duration1}ms)`);
    console.log(`    target: ${data?.target}`);
    console.log(`    durationMs: ${data?.durationMs}`);
    if (data?.collection) {
      console.log(`    collection.totalCollected: ${data.collection.totalCollected}`);
      console.log(`    collection.selectedForAnalysis: ${data.collection.selectedForAnalysis}`);
    }
    if (data?.analysis) {
      console.log(`    analysis.qualityScore: ${data.analysis.qualityScore}`);
      console.log(`    analysis.securityRiskCount: ${data.analysis.securityRiskCount}`);
      console.log(`    analysis.cryptoAlgorithms: ${JSON.stringify(data.analysis.cryptoAlgorithms)}`);
    }
    if (data?.hooks) {
      console.log(`    hooks.totalRecords: ${data.hooks.totalRecords}`);
      console.log(`    hooks.correlatedFlows: ${data.hooks.correlatedFlows?.length ?? 0}`);
    }
    if (data?.requestFingerprints) console.log(`    requestFingerprints: ${data.requestFingerprints.length}`);
    if (data?.priorityTargets) console.log(`    priorityTargets: ${data.priorityTargets.length}`);
    if (data?.actionPlan) console.log(`    actionPlan: ${data.actionPlan.length} 步`);
    if (data?.recommendedNextSteps) console.log(`    recommendedNextSteps: ${data.recommendedNextSteps.length} 条`);
    if (!valid) console.log(`    ⚠ 数据结构校验失败: 缺少 target 或 durationMs`);
  } else {
    console.log(`  ✗ 调用失败 (${duration1}ms)  [${result1.status}] ${result1.error?.slice(0, 120)}`);
  }

  // 测试 2: API 签名 hook 预设
  console.log('\n⏳ 测试 2: API 签名 hook 预设 (hookPreset=api-signature)...');
  const params2 = {
    url: 'https://qiye.qizhidao.com/',
    topN: 3,
    useAI: true,
    runDeobfuscation: true,
    hookPreset: 'api-signature',
    autoInjectHooks: true,
    waitAfterHookMs: 500,
  };
  const start2 = Date.now();
  const result2 = await invokeTool(httpUrl, args.group, 'analyze_target', params2, args.timeout);
  const duration2 = Date.now() - start2;

  if (result2.ok) {
    const data = result2.data;
    console.log(`  ✓ 调用成功 (${duration2}ms)`);
    console.log(`    hooks.preset: ${data?.hooks?.preset}`);
    console.log(`    hooks.autoInjected: ${data?.hooks?.autoInjected}`);
    console.log(`    hooks.hookIds: ${data?.hooks?.hookIds?.length ?? 0} 个`);
    console.log(`    hooks.correlatedFlows: ${data?.hooks?.correlatedFlows?.length ?? 0}`);
    console.log(`    signatureChain.candidateFunctions: ${JSON.stringify(data?.signatureChain?.candidateFunctions ?? [])}`);
  } else {
    console.log(`  ✗ 调用失败 (${duration2}ms)  [${result2.status}] ${result2.error?.slice(0, 120)}`);
  }

  // 测试 3: 缺少 url 参数
  console.log('\n⏳ 测试 3: 缺少 url 参数...');
  const start3 = Date.now();
  const result3 = await invokeTool(httpUrl, args.group, 'analyze_target', {}, args.timeout);
  const duration3 = Date.now() - start3;

  if (result3.ok) {
    const data = result3.data;
    // 预期 success=false
    const valid = data && data.success === false;
    console.log(`  ${valid ? '✓' : '⚠'} 调用成功 (${duration3}ms)`);
    console.log(`    success: ${data?.success}`);
    console.log(`    message: ${data?.message?.slice(0, 80)}`);
  } else {
    // 参数校验失败也属预期行为
    console.log(`  ✓ 调用返回错误 (预期行为) (${duration3}ms)`);
  }

  const passed = result1.ok && result1.data && result1.data.target && typeof result1.data.durationMs === 'number';

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(passed ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
