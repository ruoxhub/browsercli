#!/usr/bin/env node

/**
 * verify-all-tools.mjs — 批量调用所有 MCP 工具并生成验证报告
 *
 * 用法：
 *   node scripts/verify-all-tools.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000] [--concurrency 5] [--output report.json] [--filter hook,navigation] [--dry-run]
 *
 * 前提：Sekiro Server 和 Worker 均已运行（js-reverse start）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── 工具真实参数映射 ────────────────────────────────────
// 为有 schema 定义的工具提供真实测试参数，确保调用能真正执行

const TOOL_PARAMS = {
  // ── 工作流 ──────────────────────────────────────────
  trace_signature_generation: {
    requestUrlPattern: '/api/',
    maxResults: 3,
  },

  // ── 输入 ────────────────────────────────────────────
  click: {
    selector: 'body',
    dblClick: false,
  },

  // ── DOM ─────────────────────────────────────────────
  query_dom: {
    selector: 'body',
    all: false,
    limit: 5,
  },

  // ── 网络 ────────────────────────────────────────────
  list_network_requests: {
    pageSize: 5,
    pageIdx: 0,
  },

  // ── 页面/导航 ───────────────────────────────────────
  scroll_by: {
    direction: 'down',
    pixels: 300,
  },

  new_page: {
    url: 'https://example.com',
    timeout: 10000,
  },

  navigate_page: {
    type: 'goto',
    url: 'https://example.com',
    timeout: 10000,
  },

  select_frame: {
    frameIdx: 0,
  },

  // ── 调试器 ──────────────────────────────────────────
  list_scripts: {
    filter: '',
  },

  get_script_source: {
    scriptId: '',
  },

  monitor_events: {
    selector: 'body',
    monitorId: 'test-monitor-1',
  },

  stop_monitor: {
    monitorId: 'test-monitor-1',
  },

  // ── Hook ────────────────────────────────────────────
  get_hook_data: {
    maxRecords: 10,
  },

  remove_hook: {
    hookId: 'test-hook-1',
  },

  list_created_hooks: {
    verbose: false,
  },

  // ── 脚本执行 ────────────────────────────────────────
  evaluate_script: {
    function: '() => document.title',
    context: 'page',
    verbose: false,
  },

  inject_preload_script: {
    script: 'console.log("preload injected")',
  },

  // ── WASM ────────────────────────────────────────────
  wasm_dump: {
    moduleIndex: 0,
    outputPath: './test-output.wasm',
  },

  wasm_disassemble: {
    inputPath: './test-input.wasm',
    outputPath: './test-output.wat',
    foldExprs: true,
  },

  wasm_decompile: {
    inputPath: './test-input.wasm',
    outputPath: './test-output.c',
  },

  wasm_inspect_sections: {
    inputPath: './test-input.wasm',
    sections: 'all',
  },

  wasm_offline_run: {
    inputPath: './test-input.wasm',
    functionName: 'main',
    args: [],
    runtime: 'wasmtime',
    timeoutMs: 5000,
  },

  wasm_optimize: {
    inputPath: './test-input.wasm',
    outputPath: './test-output-optimized.wasm',
    level: 'O2',
  },

  wasm_vmp_trace: {
    maxEvents: 50,
  },

  wasm_memory_inspect: {
    offset: 0,
    length: 256,
    format: 'hex',
  },

  // ── 逆向工程/报告 ────────────────────────────────────
  record_reverse_evidence: {
    taskId: 'verify-test-task',
    taskSlug: 'verify-test-slug',
    targetUrl: 'https://example.com',
    goal: 'verify tool works',
    entry: { type: 'test-evidence', description: 'automated verification' },
  },

  export_rebuild_bundle: {
    taskId: 'verify-test-task',
    taskSlug: 'verify-test-slug',
    targetUrl: 'https://example.com',
    goal: 'verify tool works',
    autoGenerate: false,
    entryCode: 'console.log("test")',
    envCode: 'globalThis.window = globalThis;',
    capture: { test: true },
  },

  diff_env_requirements: {
    runtimeError: 'ReferenceError: window is not defined',
    observedCapabilities: ['window', 'document', 'localStorage'],
  },
};

// ─── 参数解析 ───────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    rpcHost: 'ws://127.0.0.1:5612',
    group: 'js-reverse',
    timeout: 30000,
    concurrency: 5,
    output: '',
    filter: '',
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--rpcHost': args.rpcHost = argv[++i]; break;
      case '--group': args.group = argv[++i]; break;
      case '--timeout': args.timeout = Number(argv[++i]); break;
      case '--concurrency': args.concurrency = Number(argv[++i]); break;
      case '--output': args.output = argv[++i]; break;
      case '--filter': args.filter = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
    }
  }
  return args;
}

// ─── 从 tools-meta.ts 提取工具列表和 callMode ────────────

function extractToolsFromMeta() {
  const metaPath = resolve(ROOT, 'src/cli/tools-meta.ts');
  const content = readFileSync(metaPath, 'utf-8');

  // 匹配每个工具块：name: 'xxx', ... callMode: 'yyy'
  const blockRegex = /name:\s*'([^']+)'[\s\S]*?callMode:\s*'([^']+)'/g;
  const tools = [];
  let match;

  while ((match = blockRegex.exec(content)) !== null) {
    const name = match[1];
    const callMode = match[2];
    tools.push({ name, callMode });
  }

  // 去重（按 name）
  const seen = new Set();
  return tools.filter(t => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
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
      return { ok: false, status: 'rpc_error', error: result.message || 'Sekiro action 执行失败', data: null };
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
  if (name.startsWith('hook_') || name === 'create_hook' || name === 'inject_hook' || name === 'anti_anti_hook') return 'Hook';
  if (name.includes('breakpoint') || name.includes('debug') || name.includes('step_') || name === 'resume' || name === 'pause' || name === 'inspect_locals' || name === 'evaluate_on_callframe' || name === 'get_paused_info' || name === 'start_continuous_debugging' || name === 'stop_continuous_debugging') return 'Debugger';
  if (name.includes('session') || name.includes('browser_health') || name === 'list_pages' || name === 'select_page' || name === 'new_page' || name === 'navigate_page' || name === 'list_frames' || name === 'select_frame') return 'Browser/Navigation';
  if (name.includes('network') || name.includes('websocket') || name.includes('console') || name.includes('xhr') || name === 'get_request_initiator') return 'Network/Console';
  if (name.includes('click') || name.includes('press') || name.includes('fill') || name.includes('hover') || name.includes('drag') || name.includes('type') || name.includes('upload') || name.includes('scroll') || name.includes('set_files')) return 'Input';
  if (name.includes('screenshot') || name.includes('video') || name.includes('capture_video')) return 'Screenshot/Media';
  if (name.includes('emulate') || name.includes('stealth') || name.includes('user_agent') || name.includes('resize') || name.includes('fixed_window')) return 'Emulation/Stealth';
  if (name.includes('performance')) return 'Performance';
  if (name.includes('deobfuscat') || name.includes('minify') || name.includes('transpile') || name.includes('ast') || name.includes('diff_code') || name.includes('code_template')) return 'Code Transform';
  if (name.includes('analyze') || name.includes('understand') || name.includes('summarize') || name.includes('detect') || name.includes('risk') || name.includes('export') || name.includes('collect') || name.includes('search_in_scripts') || name.includes('rebuild') || name.includes('collection') || name.includes('record_reverse')) return 'Analysis/Report';
  if (name.includes('experience') || name.includes('extension') || name.includes('dialog') || name.includes('evaluate') || name.includes('inject') || name.includes('script')) return 'Skill/Extension';
  if (name.includes('storage') || name.includes('cookie') || name.includes('local_storage') || name.includes('session_storage') || name.includes('dom') || name.includes('find_clickable') || name.includes('query_dom')) return 'DOM/Storage';
  if (name.includes('monitor') || name.includes('trace') || name.includes('inspect') || name.includes('list_hooks') || name.includes('find_in') || name.includes('paused') || name.includes('callframe') || name.includes('unhook') || name.includes('remove_hook') || name.includes('get_hook') || name.includes('list_created') || name.includes('get_hook_data') || name.includes('get_ai_debug')) return 'Debug/Inspect';
  if (name.includes('vue')) return 'Vue';
  if (name.includes('wasm')) return 'WASM';
  if (name.includes('crypto') || name.includes('anti_')) return 'Crypto/Anti';
  if (name.includes('observe') || name.includes('auto_hook') || name === 'trace_signature_generation') return 'Workflow';
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

  const sorted = [...results].sort((a, b) => b.duration - a.duration);
  const topSlow = sorted.slice(0, 10);

  const failedDetails = results.filter(r => !r.ok).map(r => ({
    tool: r.tool,
    category: r.category,
    callMode: r.callMode,
    status: r.status,
    error: r.error,
    duration: r.duration,
    hasParams: r.hasParams,
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
      callMode: r.callMode,
      ok: r.ok,
      status: r.status,
      duration: r.duration,
      hasParams: r.hasParams,
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

  lines.push('── 状态分布 ──────────────────────────────────────────────');
  for (const [status, count] of Object.entries(statusBreakdown).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.round((count / summary.total) * 40));
    lines.push(`  ${status.padEnd(20)} ${String(count).padStart(4)}  ${bar}`);
  }
  lines.push('');

  lines.push('── 分类统计 ──────────────────────────────────────────────');
  for (const [cat, stats] of Object.entries(categories).sort((a, b) => b[1].total - a[1].total)) {
    const rate = ((stats.ok / stats.total) * 100).toFixed(0);
    const mark = stats.failed === 0 ? '✓' : '✗';
    lines.push(`  ${mark} ${cat.padEnd(22)} 总: ${String(stats.total).padStart(3)}  成功: ${String(stats.ok).padStart(3)}  失败: ${String(stats.failed).padStart(3)}  (${rate}%)`);
  }
  lines.push('');

  if (topSlowTools.length > 0) {
    lines.push('── 最慢工具 Top 10 ──────────────────────────────────────');
    for (const t of topSlowTools) {
      const mark = t.ok ? 'ok' : '!!';
      lines.push(`  [${mark}] ${t.tool.padEnd(35)} ${t.duration}ms`);
    }
    lines.push('');
  }

  if (failedDetails.length > 0) {
    lines.push('── 失败详情 ──────────────────────────────────────────────');
    for (const f of failedDetails) {
      const paramTag = f.hasParams ? ' [有参数]' : '';
      const modeTag = f.callMode ? ` {${f.callMode}}` : '';
      lines.push(`  ✗ ${f.tool}${paramTag}${modeTag}  [${f.status}]  ${f.error}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}

// ─── 调试器暂停状态设置 ─────────────────────────────────

/**
 * 设置调试器暂停状态：注入一个会触发断点的脚本，然后设置断点。
 * 返回 true 表示成功进入暂停状态。
 */
async function setupPausedState(httpUrl, group, timeout) {
  // 1. 注入一个带有 debugger 语句的脚本
  const evalResult = await invokeTool(httpUrl, group, 'evaluate_script', {
    function: '() => { debugger; return "paused"; }',
    context: 'page',
    verbose: false,
  }, timeout);

  // evaluate_script 可能因为 debugger 语句而暂停
  if (evalResult.ok) {
    return true;
  }

  // 2. 回退：尝试用 pause 工具暂停
  const pauseResult = await invokeTool(httpUrl, group, 'pause', {}, timeout);
  if (pauseResult.ok) {
    return true;
  }

  return false;
}

// ─── 主流程 ───────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);
  const allTools = extractToolsFromMeta();

  // 按 filter 过滤
  const filteredTools = args.filter
    ? allTools.filter(t => {
        const keywords = args.filter.split(',').map(k => k.trim().toLowerCase());
        return keywords.some(kw => t.name.includes(kw) || categorizeTool(t.name).toLowerCase().includes(kw));
      })
    : allTools;

  const toolNames = filteredTools.map(t => t.name);
  const paramizedCount = filteredTools.filter(t => TOOL_PARAMS[t.name]).length;
  const frameTools = filteredTools.filter(t => t.callMode === 'frame').length;
  const contextTools = filteredTools.filter(t => t.callMode === 'context').length;

  console.log(`\n🔍 JSReverser-MCP 工具验证`);
  console.log(`   Sekiro: ${httpUrl}  Group: ${args.group}`);
  console.log(`   工具总数: ${filteredTools.length} (有参数: ${paramizedCount}  需页面: ${frameTools}  需上下文: ${contextTools})  并发: ${args.concurrency}  超时: ${args.timeout}ms`);
  if (args.filter) console.log(`   过滤: ${args.filter}`);
  if (args.dryRun) console.log(`   模式: dry-run (仅打印调用计划，不实际执行)`);
  console.log('');

  // dry-run 模式：只打印调用计划
  if (args.dryRun) {
    console.log('── 调用计划 ──────────────────────────────────────────────');
    for (const t of filteredTools) {
      const params = TOOL_PARAMS[t.name] ?? {};
      const hasParams = Object.keys(params).length > 0;
      const tag = hasParams ? '📋' : '  ';
      const modeTag = t.callMode === 'frame' ? '[frame]' : t.callMode === 'context' ? '[ctx]' : '';
      const paramStr = hasParams ? `  params: ${JSON.stringify(params)}` : '  params: {}';
      console.log(`  ${tag} ${t.name.padEnd(40)} ${modeTag.padEnd(8)} ${paramStr}`);
    }
    console.log(`\n   共 ${filteredTools.length} 个工具，${paramizedCount} 个带真实参数\n`);
    return;
  }

  // 检查 Sekiro Server 可用性
  console.log('⏳ 检查 Sekiro Server...');
  try {
    const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok && resp.status !== 302) throw new Error(`HTTP ${resp.status}`);
  } catch {
    console.error(`❌ Sekiro Server 不可用: ${httpUrl}`);
    console.error('   请确保 rpc-go 已启动且 Worker 已注册');
    process.exit(1);
  }
  console.log('✓ Sekiro Server 可用\n');

  // 如果有需要页面上下文的工具，先打开测试页面
  const needsPage = filteredTools.some(t => t.callMode === 'frame' || t.callMode === 'context');
  if (needsPage) {
    console.log('⏳ 打开测试页面（为 frame/context 工具准备上下文）...');
    const newPageResult = await invokeTool(httpUrl, args.group, 'new_page', { url: 'https://example.com', timeout: 10000 }, args.timeout);
    if (newPageResult.ok) {
      console.log('✓ 测试页面已打开\n');
    } else {
      // 回退到 navigate_page
      const navResult = await invokeTool(httpUrl, args.group, 'navigate_page', { type: 'goto', url: 'https://example.com', timeout: 10000 }, args.timeout);
      if (navResult.ok) {
        console.log('✓ 测试页面已打开 (navigate_page)\n');
      } else {
        console.log(`⚠ 测试页面打开失败: ${navResult.error?.slice(0, 60) || navResult.status}`);
        console.log('  frame/context 类工具可能因此失败\n');
      }
    }
  }

  // 按执行阶段分组：1)非浏览器独立工具 2)页面/上下文工具 3)浏览器状态工具
  console.log('⏳ 开始批量调用工具...\n');

  const makeTask = (toolMeta) => async () => {
    const toolName = toolMeta.name;
    const params = TOOL_PARAMS[toolName] ?? {};
    const hasParams = Object.keys(params).length > 0;
    const start = Date.now();
    const category = categorizeTool(toolName);
    const callMode = toolMeta.callMode;
    const result = await invokeTool(httpUrl, args.group, toolName, params, args.timeout);
    const duration = Date.now() - start;

    const mark = result.ok ? '✓' : '✗';
    const paramTag = hasParams ? '📋' : '  ';
    const modeTag = callMode === 'frame' ? '🖼' : callMode === 'context' ? '🔧' : '  ';
    console.log(`  ${mark}${paramTag}${modeTag} ${toolName.padEnd(40)} ${String(duration).padStart(6)}ms  ${result.ok ? '' : result.error?.slice(0, 60) || result.status}`);

    return { tool: toolName, category, callMode, ok: result.ok, status: result.status, duration, error: result.error, data: result.data, hasParams };
  };

  // 浏览器状态工具（会影响页面上下文，需在 frame 工具之前运行）
  const BROWSER_TOOLS = new Set([
    'navigate_page', 'select_page', 'list_pages',
    'check_browser_health', 'list_frames', 'select_frame',
  ]);
  // 会干扰页面上下文的工具（如打开新页面后关闭导致上下文丢失）
  const SKIP_TOOLS = new Set(['new_page']);

  // 需要调试器处于暂停状态的工具
  const NEEDS_PAUSED_STATE = new Set(['step_into', 'step_over', 'step_out', 'resume']);

  const standaloneTools = filteredTools.filter(t => t.callMode === 'params-only' && !BROWSER_TOOLS.has(t.name) && !SKIP_TOOLS.has(t.name));
  const browserTools = filteredTools.filter(t => t.callMode === 'params-only' && BROWSER_TOOLS.has(t.name));
  const dependentTools = filteredTools.filter(t => t.callMode !== 'params-only');

  // 阶段1: 非浏览器独立工具并发
  const s1Tasks = standaloneTools.map(t => makeTask(t));
  const s1Results = await runWithConcurrency(s1Tasks, args.concurrency);

  // 阶段2: 浏览器状态工具串行
  const s2Results = [];
  for (const t of browserTools) {
    s2Results.push(await makeTask(t)());
  }

  // 阶段3: 页面/上下文工具串行（frame 工具失败时重试一次）
  const s3Results = [];
  let pausedStateReady = false;

  for (const t of dependentTools) {
    // 对需要暂停状态的工具，先尝试设置断点并触发暂停
    if (NEEDS_PAUSED_STATE.has(t.name) && !pausedStateReady) {
      const setupOk = await setupPausedState(httpUrl, args.group, args.timeout);
      pausedStateReady = setupOk;
      if (!setupOk) {
        console.log(`  ⚠ 无法设置暂停状态，${t.name} 可能失败`);
      }
    }

    const result = await makeTask(t)();
    if (!result.ok && result.callMode === 'frame' && result.error?.includes('需要页面上下文')) {
      // 重试一次：先 select_page 确保有活跃页面
      await invokeTool(httpUrl, args.group, 'select_page', { pageIdx: 0 }, args.timeout);
      const retry = await makeTask(t)();
      if (retry.ok) {
        s3Results.push(retry);
        continue;
      }
    }
    // 如果暂停状态工具失败且错误是 "Execution is not paused"，重置状态标记
    if (!result.ok && NEEDS_PAUSED_STATE.has(t.name) && result.error?.includes('not paused')) {
      pausedStateReady = false;
    }
    s3Results.push(result);
  }

  const results = [...s1Results, ...s2Results, ...s3Results];

  // 生成报告
  const report = generateReport(filteredTools.map(t => t.name), results);
  const consoleReport = formatConsoleReport(report);
  console.log(consoleReport);

  // 保存 JSON 报告
  const outputPath = args.output || resolve(ROOT, `tool-verification-report-${Date.now()}.json`);
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`📄 报告已保存: ${outputPath}\n`);

  process.exit(report.summary.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(2);
});
