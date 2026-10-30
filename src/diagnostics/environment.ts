/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {accessSync, constants, existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

import {
  resolvePackageRoot,
  resolveArtifactsTasksDirForPackageRoot,
} from '../utils/projectPaths.js';

import type {
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticStatus,
} from './types.js';

function getNodeVersionStatus(version: string): DiagnosticCheck {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  const supported =
    major > 22 ||
    major === 23 ||
    (major === 22 && minor >= 12) ||
    (major === 20 && minor >= 19) ||
    (major > 20 && major < 22);

  return {
    name: 'node_version',
    status: supported ? 'ok' : 'fail',
    reason: supported
      ? `Detected supported Node version ${version}.`
      : `Detected unsupported Node version ${version}.`,
    fix: supported
      ? 'No action required.'
      : 'Upgrade to Node 20.19.0+, Node 22.12.0+, or a newer supported release.',
    details: {version},
  };
}

/**
 * 解析 CLI 构建产物入口。
 *
 * 直接从 package.json 的 `bin.browsercli` 读取，而不是在代码里再写一份路径：
 * 该字段本来就是构建产物位置的唯一事实来源，写死路径会在目录迁移后静默失配
 * （历史上曾把 `build/src/cli/bin/browsercli.js` 误写为 `build/src/bin/...`，
 * 导致诊断恒定 fail）。读不到 package.json 时退回同一约定路径。
 */
function resolveBuildEntry(packageRoot: string): string {
  const pkgPath = path.join(packageRoot, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      bin?: string | Record<string, string>;
    };
    const bin = pkg.bin;
    const declared = typeof bin === 'string' ? bin : bin?.['browsercli'];
    if (declared) return path.resolve(packageRoot, declared);
  } catch {
    // package.json 缺失或非法：退回约定路径，由 existsSync 给出结论。
  }
  return path.join(packageRoot, 'build', 'src', 'cli', 'bin', 'browsercli.js');
}

function getBuildOutputStatus(packageRoot: string): DiagnosticCheck {
  const buildEntry = resolveBuildEntry(packageRoot);
  const exists = existsSync(buildEntry);
  return {
    name: 'build_output',
    status: exists ? 'ok' : 'fail',
    reason: exists
      ? `Build entry exists at ${buildEntry}.`
      : `Build entry is missing at ${buildEntry}.`,
    fix: exists
      ? 'No action required.'
      : 'Run `npm run build` before starting.',
    details: {buildEntry},
  };
}

function getArtifactsDirectoryStatus(): DiagnosticCheck {
  const packageRoot = resolvePackageRoot(import.meta.url);
  const artifactsDir = resolveArtifactsTasksDirForPackageRoot(packageRoot);
  try {
    accessSync(path.dirname(artifactsDir), constants.W_OK);
    return {
      name: 'artifacts_dir',
      status: 'ok',
      reason: `Artifacts parent directory is writable for ${artifactsDir}.`,
      fix: 'No action required.',
      details: {artifactsDir},
    };
  } catch (error) {
    return {
      name: 'artifacts_dir',
      status: 'warn',
      reason: `Artifacts parent directory is not writable: ${String(error)}.`,
      fix: 'Set BROWSER_ARTIFACTS_DIR to a writable path before running task exports.',
      details: {artifactsDir},
    };
  }
}

function summarizeStatus(checks: DiagnosticCheck[]): DiagnosticStatus {
  if (checks.some(item => item.status === 'fail')) return 'fail';
  if (checks.some(item => item.status === 'warn')) return 'warn';
  return 'ok';
}

function buildSummary(
  checks: DiagnosticCheck[],
  status: DiagnosticStatus,
): string {
  const counts = checks.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    {ok: 0, warn: 0, fail: 0},
  );
  return `Diagnostics completed with status=${status} (ok=${counts.ok}, warn=${counts.warn}, fail=${counts.fail}).`;
}

export function runEnvironmentDiagnostics(): DiagnosticReport {
  const packageRoot = resolvePackageRoot(import.meta.url);
  const checks: DiagnosticCheck[] = [
    getNodeVersionStatus(process.version),
    getBuildOutputStatus(packageRoot),
    getArtifactsDirectoryStatus(),
  ];

  const status = summarizeStatus(checks);
  return {
    status,
    summary: buildSummary(checks, status),
    checks,
  };
}
