#!/usr/bin/env node

/**
 * verify-all.mjs — 批量运行所有 Analyzer 模块验证脚本
 *
 * 用法：
 *   node scripts/analyzer/verify-all.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 60000] [--quick]
 *
 * --quick: 跳过重量级工具 (analyze_target, summarize batch/project)
 */

import { execFile } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const SCRIPTS = [
  { file: 'verify-deobfuscate.mjs', tool: 'deobfuscate_code', weight: 'light' },
  { file: 'verify-understand.mjs', tool: 'understand_code', weight: 'light' },
  { file: 'verify-summarize.mjs', tool: 'summarize_code', weight: 'light' },
  { file: 'verify-detect-crypto.mjs', tool: 'detect_crypto', weight: 'light' },
  { file: 'verify-risk-panel.mjs', tool: 'risk_panel', weight: 'light' },
  { file: 'verify-record-evidence.mjs', tool: 'record_reverse_evidence', weight: 'light' },
  { file: 'verify-export-report.mjs', tool: 'export_session_report', weight: 'light' },
  { file: 'verify-analyze-target.mjs', tool: 'analyze_target', weight: 'heavy' },
];

function parseArgs(argv) {
  const args = { rpcHost: 'ws://127.0.0.1:5612', group: 'js-reverse', timeout: 60000, quick: false };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--rpcHost': args.rpcHost = argv[++i]; break;
      case '--group': args.group = argv[++i]; break;
      case '--timeout': args.timeout = Number(argv[++i]); break;
      case '--quick': args.quick = true; break;
    }
  }
  return args;
}

function runScript(scriptPath, args) {
  return new Promise(resolve => {
    const passArgs = [
      '--rpcHost', args.rpcHost,
      '--group', args.group,
      '--timeout', String(args.timeout),
    ];
    if (scriptPath.includes('verify-summarize') && args.quick) {
      passArgs.push('--mode', 'single');
    }

    const start = Date.now();
    const child = execFile('node', [scriptPath, ...passArgs], {
      cwd: ROOT,
      timeout: args.timeout + 10000,
      shell: true,
    }, (error, stdout, stderr) => {
      const duration = Date.now() - start;
      const passed = !error;
      resolve({ passed, duration, stdout, stderr: stderr?.slice(0, 500), error: error?.message?.slice(0, 200) });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const scripts = args.quick
    ? SCRIPTS.filter(s => s.weight !== 'heavy')
    : SCRIPTS;

  console.log('\n🔍 Analyzer 模块 — 全工具验证');
  console.log(`   模式: ${args.quick ? 'quick (跳过重量级工具)' : 'full'}`);
  console.log(`   脚本数: ${scripts.length}`);
  console.log(`   Sekiro: ${args.rpcHost}  Group: ${args.group}  Timeout: ${args.timeout}ms\n`);

  const results = [];

  for (const script of scripts) {
    const scriptPath = resolve(__dirname, script.file);
    console.log(`⏳ 运行 ${script.file} (${script.tool})...`);

    const result = await runScript(scriptPath, args);
    const mark = result.passed ? '✓' : '✗';

    console.log(`  ${mark} ${script.tool.padEnd(30)} ${result.duration}ms`);

    // 打印子脚本的关键输出行（✓/✗/⚠ 开头的行）
    const keyLines = (result.stdout || '')
      .split('\n')
      .filter(line => /^\s*[✓✗⚠]|结果:/.test(line))
      .map(line => '    ' + line.trim())
      .join('\n');
    if (keyLines) console.log(keyLines);

    if (!result.passed && result.stderr) {
      const errLines = result.stderr.split('\n').slice(0, 3).map(l => '    ' + l).join('\n');
      console.log(errLines);
    }

    results.push({
      tool: script.tool,
      file: script.file,
      weight: script.weight,
      ...result,
    });
  }

  // 汇总
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           Analyzer 模块验证汇总');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  总计: ${total}  |  通过: ${passed}  |  失败: ${failed}  |  通过率: ${((passed / total) * 100).toFixed(1)}%`);
  console.log('');

  for (const r of results) {
    const mark = r.passed ? '✓' : '✗';
    const weightTag = r.weight === 'heavy' ? '[重]' : '    ';
    console.log(`  ${mark} ${weightTag} ${r.tool.padEnd(30)} ${r.duration}ms`);
  }

  if (failed > 0) {
    console.log('');
    console.log('── 失败详情 ──────────────────────────────────────────────');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ✗ ${r.tool} (${r.file})`);
      if (r.error) console.log(`    error: ${r.error}`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
