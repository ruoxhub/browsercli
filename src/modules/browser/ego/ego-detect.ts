/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Locates the `ego-browser` CLI that ships inside an `ego lite` install.
 *
 * ego lite exposes its CDP native binding only to its own embedded Node runtime,
 * and the only supported way in is that installed CLI (`ego-browser nodejs -e`).
 * The app is per-user and per-version-installable, so discovery has to scan the
 * install root for version directories and pick the newest one numerically.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface EgoDetectOptions {
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * Candidate base directories, overriding the platform defaults:
   * the version root (`.../ego lite/Application`) on Windows and the app bundle
   * (`.../ego lite.app`) on macOS.
   */
  roots?: readonly string[];
}

const CLI_NAME = 'ego-browser';
/** Vendored framework that carries the helper on macOS. */
const MAC_FRAMEWORK = path.join(
  'Contents',
  'Frameworks',
  'ego Framework.framework',
);
const WIN_APP_PATH = path.join('Citro Labs', 'ego lite', 'Application');
const MAC_APP_NAME = 'ego lite.app';

/**
 * The install roots to search, in order. Callers use this both to look for the
 * CLI and to tell a user where it looked.
 */
export function egoSearchRoots(options: EgoDetectOptions = {}): string[] {
  if (options.roots) return [...options.roots];
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  if (platform === 'darwin') {
    const home = env['HOME'] ?? '';
    return [
      path.join('/Applications', MAC_APP_NAME),
      // Per-user installs.
      ...(home ? [path.join(home, 'Applications', MAC_APP_NAME)] : []),
    ];
  }

  if (platform === 'win32') {
    // ego lite installs per machine and per user; any of the three roots can
    // hold the newest build, so all of them are searched.
    const bases = [
      env['PROGRAMFILES'] ?? 'C:\\Program Files',
      env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
      env['LOCALAPPDATA'] ?? '',
    ].filter(base => base.length > 0);
    return bases.map(base => path.join(base, WIN_APP_PATH));
  }

  return [];
}

/**
 * The newest `ego-browser` CLI found, or `null` when ego lite is not installed.
 *
 * `EGO_BROWSER_CLI` wins over discovery: it is the escape hatch for a
 * non-standard install location.
 */
export function findEgoBrowserBinary(
  options: EgoDetectOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const override = env['EGO_BROWSER_CLI']?.trim();
  if (override) return override;

  const roots = egoSearchRoots({...options, env, platform});
  if (platform === 'darwin') {
    for (const root of roots) {
      const helper = findMacHelper(root);
      if (helper) return helper;
    }
    return null;
  }

  let newest: {version: number[]; binary: string} | undefined;
  for (const root of roots) {
    for (const entry of readDir(root)) {
      const version = parseVersion(entry);
      if (!version) continue;
      const binary = path.join(root, entry, cliFileName(platform));
      if (!isFile(binary)) continue;
      if (!newest || compareVersions(version, newest.version) > 0) {
        newest = {version, binary};
      }
    }
  }
  return newest?.binary ?? null;
}

function cliFileName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${CLI_NAME}.exe` : CLI_NAME;
}

/**
 * macOS: the helper lives in the bundled framework. `Versions/Current` is the
 * stable path (a symlink to the active build), so it is preferred over scanning,
 * which is only a fallback for a bundle where the symlink is missing.
 */
function findMacHelper(appBundle: string): string | null {
  const framework = path.join(appBundle, MAC_FRAMEWORK);
  const fileName = cliFileName('darwin');

  const current = path.join(
    framework,
    'Versions',
    'Current',
    'Helpers',
    fileName,
  );
  if (isFile(current)) return current;

  const versioned = readDir(path.join(framework, 'Versions'))
    .filter(name => name !== 'Current' && parseVersion(name) !== null)
    .sort((a, b) => compareVersions(parseVersion(b)!, parseVersion(a)!))
    .map(name => path.join(framework, 'Versions', name, 'Helpers', fileName))
    .find(isFile);
  if (versioned) return versioned;

  const flat = path.join(framework, 'Helpers', fileName);
  return isFile(flat) ? flat : null;
}

/** Parses `0.6.1.13`; `null` for anything that is not all-numeric segments. */
function parseVersion(name: string): number[] | null {
  if (!/^\d+(\.\d+)*$/.test(name)) return null;
  return name.split('.').map(Number);
}

/** Numeric, segment-wise: `0.6.1.13` beats `0.6.1.9`, which string order reverses. */
function compareVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function readDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}
