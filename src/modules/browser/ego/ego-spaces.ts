/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Read the task spaces and profiles ego currently has, for `browser space list`.
 *
 * This deliberately does NOT go through `EgoBridgeManager`: listing is a
 * read-only question about ego's state, not an operation on a browser
 * connection. Spinning up a bridge (which enters a task space, opens a port and
 * takes ownership of a space) just to print a table would be a side effect the
 * user did not ask for — and on a machine where the daemon is not running it
 * would also mean `space list` cannot run at all.
 *
 * So it uses the same host contract as everything else here: `ego-browser nodejs
 * -e` (or a script file fed on stdin), with the result written to a file rather
 * than stdout, because ego's embedded runtime never streams stdout to the
 * spawner.
 */

import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {findEgoBrowserBinary} from './ego-detect.js';

/** One row of `browser space list`. */
export interface EgoSpaceRow {
  id: number;
  name: string;
  taskId?: string;
  ownership?: string;
  createdBy?: string;
  profileId?: string;
  profileName?: string;
  recentTabTitles?: string[];
}

export interface EgoProfileRow {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface EgoSpaceSnapshot {
  spaces: EgoSpaceRow[];
  profiles: EgoProfileRow[];
}

export interface EgoSpaceQueryOptions {
  /** Overrides binary discovery (tests, or a non-standard install). */
  binary?: string | null;
  /** How long the whole query may take. */
  timeoutMs?: number;
  /** Injected for tests; defaults to the real implementation. */
  runScript?: (binary: string, script: string) => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** Result marker so a partially-written file is never parsed as data. */
const RESULT_PREFIX = '__EGO_SPACES__';

/**
 * The script that runs inside ego's runtime.
 *
 * Kept as a plain string with no repo imports: it executes in ego's embedded
 * runtime, which cannot resolve this project's modules. It writes a single
 * marker-prefixed JSON line so the parent can tell "no rows" apart from "the
 * script never ran".
 */
const QUERY_SCRIPT = `
const push = value => emit(value);
try {
  const spaces = await globalThis.ego.listTaskSpaces();
  const list = spaces && Array.isArray(spaces.taskSpaces) ? spaces.taskSpaces : [];
  let profiles = [];
  if (typeof globalThis.ego.listProfiles === 'function') {
    const result = await globalThis.ego.listProfiles();
    profiles = result && Array.isArray(result.profiles) ? result.profiles : [];
  }
  push(${JSON.stringify(RESULT_PREFIX)} + JSON.stringify({
    spaces: list.map(space => ({
      id: space && space.id,
      name: space && space.name,
      taskId: space && space.taskId,
      ownership: space && space.ownership,
      createdBy: space && space.createdBy,
      profileId: space && space.profileId,
      profileName: space && space.profileName,
      recentTabTitles: space && space.recentTabTitles,
    })),
    profiles: profiles.map(profile => ({
      id: profile && profile.id,
      name: profile && profile.name,
      isDefault: profile && profile.isDefault === true,
    })),
  }));
} catch (error) {
  push(${JSON.stringify(RESULT_PREFIX)} + JSON.stringify({
    error: String((error && error.message) || error),
    spaces: [],
    profiles: [],
  }));
}
`;

/**
 * Query ego for its spaces and profiles.
 *
 * Throws with an actionable message when ego is absent or the query produces no
 * result — never returns a silently empty table, which would read as "you have
 * no spaces" instead of "I could not ask".
 */
export async function queryEgoSpaces(
  options: EgoSpaceQueryOptions = {},
): Promise<EgoSpaceSnapshot> {
  const binary =
    options.binary === undefined ? findEgoBrowserBinary() : options.binary;
  if (binary === null) {
    throw new Error(
      'ego lite 未安装或未找到 ego-browser CLI（可用 EGO_BROWSER_CLI 指定路径）',
    );
  }
  if (!fs.existsSync(binary)) {
    throw new Error(`ego-browser CLI 不存在：${binary}`);
  }

  const runScript = options.runScript ?? defaultRunScript;
  const raw = await runScript(binary, QUERY_SCRIPT);
  return parseResult(raw);
}

/**
 * Parse the marker-prefixed JSON line.
 *
 * A missing marker means the script never completed: ego's runtime writes
 * diagnostics into the same stream, so scanning for the last marker is the only
 * reliable read, and its absence must be an error rather than an empty list.
 */
export function parseResult(raw: string): EgoSpaceSnapshot {
  const line = raw
    .split(/\r?\n/)
    .filter(candidate => candidate.startsWith(RESULT_PREFIX))
    .pop();
  if (line === undefined) {
    throw new Error(
      `ego 没有返回任务空间数据（输出：${raw.trim().slice(0, 200) || '空'}）`,
    );
  }
  let parsed: {
    error?: unknown;
    spaces?: unknown;
    profiles?: unknown;
  };
  try {
    parsed = JSON.parse(line.slice(RESULT_PREFIX.length)) as typeof parsed;
  } catch {
    throw new Error('ego 返回的任务空间数据无法解析');
  }
  if (typeof parsed.error === 'string' && parsed.error !== '') {
    throw new Error(`ego 报告错误：${parsed.error}`);
  }
  return {
    spaces: asRows<EgoSpaceRow>(
      parsed.spaces,
      row => typeof row.id === 'number',
    ),
    profiles: asRows<EgoProfileRow>(
      parsed.profiles,
      row => typeof row.id === 'string',
    ),
  };
}

function asRows<T>(raw: unknown, isRow: (row: T) => boolean): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (row): row is T =>
      typeof row === 'object' && row !== null && isRow(row as T),
  );
}

/**
 * Run the script inside ego and return everything it produced.
 *
 * Scratch files in `os.tmpdir()` rather than stdout: probed against 0.6.1.13,
 * ego's runtime only executes `-e` at stdin EOF and never forwards the script's
 * stdout to the spawner, so a pipe would come back empty.
 */
function defaultRunScript(binary: string, script: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ego-spaces-'));
  const scriptPath = path.join(dir, 'query.mjs');
  const resultPath = path.join(dir, 'result.txt');
  fs.writeFileSync(
    scriptPath,
    // `console.log` cannot be reassigned in ego's runtime ("Cannot assign to
    // read only property 'log'"), so the script writes to the sink file
    // directly through `emit(...)` instead of redirecting the console.
    `const fs = await import('node:fs');\n` +
      `const sink = ${JSON.stringify(resultPath)};\n` +
      `const emit = line => { try { fs.appendFileSync(sink, line + String.fromCharCode(10)); } catch {} };\n` +
      `${script}\n`,
    'utf8',
  );

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      binary,
      [
        'nodejs',
        '-e',
        `await import(${JSON.stringify(pathToFileUrl(scriptPath))})`,
      ],
      {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true},
    );
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`查询 ego 任务空间超时（${DEFAULT_TIMEOUT_MS}ms）`));
    }, DEFAULT_TIMEOUT_MS);

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    // Drain stdout so a chatty child cannot block on a full pipe.
    child.stdout?.resume();

    const finish = (error: Error | undefined): void => {
      clearTimeout(timer);
      let result = '';
      try {
        if (fs.existsSync(resultPath)) {
          result = fs.readFileSync(resultPath, 'utf8');
        }
      } catch {
        // Left empty; `parseResult` turns a missing marker into an error.
      }
      fs.rmSync(dir, {recursive: true, force: true});
      if (error) reject(error);
      // Fold the launcher's own stderr into the payload so a failure to reach
      // the runtime is reported with its reason instead of "empty output".
      else
        resolve(
          stderr === ''
            ? result
            : `${result}
${stderr}`,
        );
    };

    child.once('error', err => finish(err));
    // The script's own marker decides success. A non-zero exit can still carry a
    // usable result (the script catches its own errors and reports them inside
    // the marker), so the exit code is not treated as fatal here: `parseResult`
    // rejects when there is no marker, and that message includes stderr.
    child.once('exit', () => finish(undefined));
  });
}

function pathToFileUrl(target: string): string {
  const normalized = target.replace(/\\/g, '/');
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${withSlash}`;
}
