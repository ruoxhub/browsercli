#!/usr/bin/env node

/**
 * verify-all-tools.mjs — 批量调用所有 MCP 工具并生成验证报告
 *
 * 用法：
 *   node scripts/verify-all-tools.mjs [--sekiroHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000] [--concurrency 5] [--output report.json]
 *
 * 前提：Sekiro Server 和 Worker 均已运行（js-reverse start）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── 参数解析 ───────────────────────────────────────────

function parseArgs(argv) {
  const args = { sekiroHost: 'ws://127.0.0.1:5612', group: 'js-reverse', timeout: 30000, concurrency: 5, output: '' };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--sekiroHost': args.sekiroHost = argv[++i]; break;
      case '--group': args.group = argv[++i]; break;
      case '--timeout': args.timeout = Number(argv[++i]); break;
      case '--concurrency': args.concurrency = Number(argv[++i]); break;
      case '--output': args.output = argv[++i]; break;
    }
  }
  return args;
}

// ─── 从 tools-meta.ts 提取工具列表 ──────────────────────

function extractToolsFromMeta() {
  const metaPath = resolve(ROOT, 'src/cli/tools-meta.ts');
  const content = readFileSync(metaPath, 'utf-8');

  const tools = [];
  const regex = /name:\s*'([^']+)'/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    tools.push(match[1]);
  }
  return [...new Set(tools)];
}

// ─── Sekiro HTTP 调用 ─────────────────────────────────

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

// ─── 并发控制 ─────────────────────────────────────────

async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      const task = tasks[i];
      results[i] = await task();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── 工具分类 ─────────────────────────────────────────

function categorizeTool(name) {
  if (name.startsWith('hook_')) return 'Hook';
  if (name.includes('breakpoint') || name.includes('debug') || name.includes('step_') || name === 'resume' || name === 'pause') return 'Debugger';
  if (name.includes('session') || name.includes('browser_health') || name.includes('page') || name.includes('frame')) return 'Browser/Navigation';
  if (name.includes('network') || name.includes('websocket') || name.includes('console') || name.includes('xhr')) return 'Network/Console';
  if (name.includes('click') || name.includes('press') || name.includes('fill') || name.includes('hover') || name.includes('drag') || name.includes('type') || name.includes('upload') || name.includes('scroll') || name.includes('set_files')) return 'Input';
  if (name.includes('screenshot') || name.includes('video') || name.includes('capture')) return 'Screenshot/Media';
  if (name.includes('emulate') || name.includes('stealth') || name.includes('user_agent') || name.includes('resize') || name.includes('fixed_window')) return 'Emulation/Stealth';
  if (name.includes('performance')) return 'Performance';
  if (name.includes('deobfuscate') || name.includes('minify') || name.includes('transpile') || name.includes('ast') || name.includes('diff_code') || name.includes('code_template')) return 'Code Transform';
  if (name.includes('analyze') || name.includes('understand') || name.includes('summarize') || name.includes('detect') || name.includes('risk') || name.includes('export') || name.includes('collect') || name.includes('search_in_scripts') || name.includes('rebuild') || name.includes('collection')) return 'Analysis/Report';
  if (name.includes('skill') || name.includes('experience') || name.includes('extension') || name.includes('dialog') || name.includes('evaluate') || name.includes('inject') || name.includes('script')) return 'Skill/Extension';
  if (name.includes('storage') || name.includes('cookie') || name.includes('local_storage') || name.includes('session_storage') || name.includes('dom') || name.includes('find_clickable')) return 'DOM/Storage';
  if (name.includes('monitor') || name.includes('trace') || name.includes('inspect') || name.includes('list_hooks') || name.includes('find_in') || name.includes('get_request_initiator') || name.includes('paused') || name.includes('callframe') || name.includes('hook_function') || name.includes('unhook') || name.includes('create_hook') || name.includes('remove_hook') || name.includes('get_hook') || name.includes('list_created')) return 'Debug/Inspect';
  if (name.includes('vue') || name.includes('crypto') || name.includes('anti_')) return 'Framework/Anti';
  return 'Other';
}

// ─── 报告生成 ─────────────────────────────────────────

function generateReport(toolNames, results) {
  const timestamp = new Date().toISOString();
  const total = results.length;
  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const categories = {};

  for (const r of results) {
    const cat = r.category;
    if (!categories[cat]) categories[cat] = { total: 0, ok: 0, failed: 0 };
    categories[cat].total++;
    if (r.ok) categories[cat].ok++;
    else categories[cat].failed++;
  }

  const statusBreakdown = {};
  for (const r of results) {
    statusBreakdown[r.status] = (statusBreakdown[r.status] || 0) + 1;
  }

  // 按耗时排序
  const sorted = [...results].sort((a, b) => b.duration - a.duration);
  const topSlow = sorted.slice(0, 10);

  // 失败详情
  const failedDetails = results.filter(r => !r.ok).map(r => ({
    tool: r.tool,
    category: r.category,
    status: r.status,
    error: r.error,
    duration: r.duration,
  }));

  const report = {
    title: 'JSReverser-MCP 工具验证报告',
    timestamp,
    summary: { total, ok, failed, successRate: `${((ok / total) * 100).toFixed(1)}%` },
    statusBreakdown,
    categories,
    topSlowTools: topSlow.map(r => ({ tool: r.tool, duration: r.duration, ok: r.ok })),
    failedDetails,
    results: results.map(r => ({
      tool: r.tool,
      category: r.category,
      ok: r.ok,
      status: r.status,
      duration: r.duration,
      error: r.ok ? undefined : r.error,
      dataPreview: r.ok ? truncate(JSON.stringify(r.data), 200) : undefined,
    })),
  };

  return report;
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...';
}

function formatConsoleReport(report) {
  const lines = [];
  const { summary, statusBreakdown, categories, topSlowTools, failedDetails } = report;

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('           JSReverser-MCP 工具验证报告');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push(`  时间: ${report.timestamp}`);
  lines.push(`  总计: ${summary.total}  |  成功: ${summary.ok}  |  失败: ${summary.failed}  |  成功率: ${summary.successRate}`);
  lines.push('');

  // 状态分布
  lines.push('── 状态分布 ──────────────────────────────────────────────');
  for (const [status, count] of Object.entries(statusBreakdown).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.round((count / summary.total) * 40));
    lines.push(`  ${status.padEnd(20)} ${String(count).padStart(4)}  ${bar}`);
  }
  lines.push('');

  // 分类统计
  lines.push('── 分类统计 ──────────────────────────────────────────────');
  for (const [cat, stats] of Object.entries(categories).sort((a, b) => b[1].total - a[1].total)) {
    const rate = ((stats.ok / stats.total) * 100).toFixed(0);
    const mark = stats.failed === 0 ? '✓' : '✗';
    lines.push(`  ${mark} ${cat.padEnd(22)} 总: ${String(stats.total).padStart(3)}  成功: ${String(stats.ok).padStart(3)}  失败: ${String(stats.failed).padStart(3)}  (${rate}%)`);
  }
  lines.push('');

  // 最慢工具
  if (topSlowTools.length > 0) {
    lines.push('── 最慢工具 Top 10 ──────────────────────────────────────');
    for (const t of topSlowTools) {
      const mark = t.ok ? 'ok' : '!!';
      lines.push(`  [${mark}] ${t.tool.padEnd(35)} ${t.duration}ms`);
    }
    lines.push('');
  }

  // 失败详情
  if (failedDetails.length > 0) {
    lines.push('── 失败详情 ──────────────────────────────────────────────');
    for (const f of failedDetails) {
      lines.push(`  ✗ ${f.tool}  [${f.status}]  ${f.error}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}

// ─── 主流程 ───────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.sekiroHost);
  const toolNames = extractToolsFromMeta();

  console.log(`\n🔍 JSReverser-MCP 工具验证`);
  console.log(`   Sekiro: ${httpUrl}  Group: ${args.group}`);
  console.log(`   工具总数: ${toolNames.length}  并发: ${args.concurrency}  超时: ${args.timeout}ms\n`);

  // 检查 Sekiro Server 可用性
  console.log('⏳ 检查 Sekiro Server...');
  try {
    const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok && resp.status !== 302) throw new Error(`HTTP ${resp.status}`);
  } catch {
    console.error(`❌ Sekiro Server 不可用: ${httpUrl}`);
    console.error('   请确保 sekiro-go 已启动且 Worker 已注册');
    process.exit(1);
  }
  console.log('✓ Sekiro Server 可用\n');

  // 批量调用
  console.log('⏳ 开始批量调用工具...\n');

  const tasks = toolNames.map(toolName => async () => {
    const start = Date.now();
    const category = categorizeTool(toolName);
    const result = await invokeTool(httpUrl, args.group, toolName, {}, args.timeout);
    const duration = Date.now() - start;

    const mark = result.ok ? '✓' : '✗';
    console.log(`  ${mark} ${toolName.padEnd(40)} ${String(duration).padStart(6)}ms  ${result.ok ? '' : result.error?.slice(0, 60) || result.status}`);

    return { tool: toolName, category, ok: result.ok, status: result.status, duration, error: result.error, data: result.data };
  });

  const results = await runWithConcurrency(tasks, args.concurrency);

  // 生成报告
  const report = generateReport(toolNames, results);
  const consoleReport = formatConsoleReport(report);
  console.log(consoleReport);

  // 保存 JSON 报告
  const outputPath = args.output || resolve(ROOT, `tool-verification-report-${Date.now()}.json`);
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`📄 报告已保存: ${outputPath}\n`);

  // 退出码
  process.exit(report.summary.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(2);
});
