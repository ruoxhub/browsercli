/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {accessSync, constants, existsSync} from 'node:fs';
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

function getBuildOutputStatus(packageRoot: string): DiagnosticCheck {
  const buildEntry = path.join(
    packageRoot,
    'build',
    'src',
    'bin',
    'proxycli.js',
  );
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
