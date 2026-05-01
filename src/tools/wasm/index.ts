/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, normalize, relative, resolve} from 'node:path';

import type {Page} from 'patchright';

import {getRuntime} from '../../runtime.js';

type WasmToolName =
  | 'wabt.wasm2wat'
  | 'wabt.wasm-decompile'
  | 'wabt.wasm-objdump'
  | 'binaryen.wasm-opt'
  | 'runtime.wasmtime'
  | 'runtime.wasmer';

type Args = Record<string, unknown>;

interface ToolSpec {
  command: string;
  versionArgs: string[];
}

interface RunResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

interface ProbeResult {
  available: boolean;
  path?: string;
  version?: string;
  reason?: string;
}

interface EvalErrorResult {
  error: string;
}

interface WasmDumpEvalSuccess {
  exports: unknown;
  importMods: unknown;
  size: unknown;
  moduleCount: number;
}

type WasmDumpEvalResult = EvalErrorResult | WasmDumpEvalSuccess;

interface WasmVmpTraceEvalSuccess {
  totalEvents: number;
  capturedEvents: number;
  topFunctions: Array<{name: string; count: number}>;
  trace: Array<{mod: unknown; fn: unknown; args: unknown; ts: unknown}>;
}

type WasmVmpTraceEvalResult = EvalErrorResult | WasmVmpTraceEvalSuccess;

interface WasmMemoryInspectEvalSuccess {
  totalMemoryPages: number;
  totalMemoryBytes: number;
  data: number[];
  searchResults?: Array<{offset: number}>;
}

type WasmMemoryInspectEvalResult =
  | EvalErrorResult
  | WasmMemoryInspectEvalSuccess;

const WASM_TOOL_TIMEOUT_MS = 60_000;
const WASM_OPTIMIZE_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 512 * 1024;

const TOOL_SPECS: Record<WasmToolName, ToolSpec> = {
  'wabt.wasm2wat': {command: 'wasm2wat', versionArgs: ['--version']},
  'wabt.wasm-decompile': {
    command: 'wasm-decompile',
    versionArgs: ['--version'],
  },
  'wabt.wasm-objdump': {command: 'wasm-objdump', versionArgs: ['--version']},
  'binaryen.wasm-opt': {command: 'wasm-opt', versionArgs: ['--version']},
  'runtime.wasmtime': {command: 'wasmtime', versionArgs: ['--version']},
  'runtime.wasmer': {command: 'wasmer', versionArgs: ['--version']},
};

function argString(args: Args, key: string, fallback?: string) {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

function argRequiredString(args: Args, key: string) {
  const value = argString(args, key);
  if (!value) {
    throw new Error(`Missing required string argument: "${key}"`);
  }
  return value;
}

function argNumber(args: Args, key: string, fallback: number) {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function argBool(args: Args, key: string, fallback: boolean) {
  const value = args[key];
  return typeof value === 'boolean' ? value : fallback;
}

function argStringArray(args: Args, key: string) {
  const value = args[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function hasErrorResult(value: unknown): value is EvalErrorResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
  );
}

function projectRoot() {
  return process.cwd();
}

function isInside(base: string, candidate: string) {
  const relativePath = relative(normalize(base), normalize(candidate));
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  );
}

function validateOutputPath(outputPath: string) {
  const safePath = resolve(outputPath);
  const roots = [projectRoot(), tmpdir()].map(root => normalize(root));
  if (!roots.some(root => isInside(root, safePath))) {
    throw new Error(
      'Path traversal blocked: outputPath must be under project root or temp directory',
    );
  }
  return safePath;
}

async function resolveArtifactPath(options: {
  toolName: string;
  target?: string;
  ext: string;
}) {
  const dir = resolve(projectRoot(), 'artifacts', 'wasm');
  await mkdir(dir, {recursive: true});
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const target = options.target ? `-${sanitizeFilename(options.target)}` : '';
  const name = `${sanitizeFilename(options.toolName)}${target}-${ts}-${randomBytes(3).toString('hex')}.${options.ext}`;
  const absolutePath = resolve(dir, name);
  return {
    absolutePath,
    displayPath: relative(projectRoot(), absolutePath).replace(/\\/g, '/'),
  };
}

function sanitizeFilename(value: string) {
  return value
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);
}

function buildEnv() {
  const env: Record<string, string> = {PATH: process.env.PATH ?? ''};
  if (process.platform === 'win32') {
    for (const key of ['SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
      const value = process.env[key];
      if (value) {
        env[key] = value;
      }
    }
  }
  return env;
}

async function runExternalTool(
  tool: WasmToolName,
  args: string[],
  timeoutMs = WASM_TOOL_TIMEOUT_MS,
): Promise<RunResult> {
  const spec = TOOL_SPECS[tool];
  const startTime = Date.now();

  return new Promise(resolvePromise => {
    const child = spawn(spec.command, args, {
      cwd: projectRoot(),
      env: buildEnv(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        ok: exitCode === 0,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        durationMs: Date.now() - startTime,
        truncated: stdoutTruncated || stderrTruncated,
      });
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => finish(null, 'SIGKILL'), 2_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= MAX_STDOUT_BYTES) {
        stdoutTruncated = true;
        return;
      }
      const remaining = MAX_STDOUT_BYTES - stdoutBytes;
      const slice =
        chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      stdoutChunks.push(slice);
      stdoutBytes += slice.length;
      stdoutTruncated ||= slice.length < chunk.length;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) {
        stderrTruncated = true;
        return;
      }
      const remaining = MAX_STDERR_BYTES - stderrBytes;
      const slice =
        chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      stderrChunks.push(slice);
      stderrBytes += slice.length;
      stderrTruncated ||= slice.length < chunk.length;
    });

    child.on('close', (code, signal) =>
      finish(code, signal as NodeJS.Signals | null),
    );
    child.on('error', error => {
      stderrChunks.push(Buffer.from(`Spawn error: ${error.message}`));
      finish(1, null);
    });
  });
}

async function probeTool(tool: WasmToolName): Promise<ProbeResult> {
  const spec = TOOL_SPECS[tool];
  const result = await runExternalTool(tool, spec.versionArgs, 5_000);
  if (!result.ok) {
    return {
      available: false,
      reason:
        result.stderr.trim() || `${spec.command} exited ${result.exitCode}`,
    };
  }
  return {
    available: true,
    path: spec.command,
    version: result.stdout.trim() || result.stderr.trim() || undefined,
  };
}

async function probeAllTools() {
  const entries = await Promise.all(
    (Object.keys(TOOL_SPECS) as WasmToolName[]).map(async tool => [
      tool,
      await probeTool(tool),
    ]),
  );
  return Object.fromEntries(entries) as Record<WasmToolName, ProbeResult>;
}

function textPreview(text: string, maxLines: number) {
  const lines = text.split('\n');
  return {
    totalLines: lines.length,
    preview:
      lines.slice(0, maxLines).join('\n') +
      (lines.length > maxLines ? '\n... (truncated)' : ''),
  };
}

async function getActivePage(): Promise<Page> {
  return getRuntime().contextProvider!.getActivePage();
}

export async function wasmCapabilities() {
  const probes = await probeAllTools();
  let pageCapability;

  try {
    const page = await getActivePage();
    const probe = await page.evaluate(() => {
      const win = window as unknown as {
        __aiHooks?: Record<string, unknown>;
        __wasmModuleStorage?: unknown[];
        __wasmInstances?: unknown[];
      };
      const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
      const hooks = Array.isArray(hooksRaw)
        ? (hooksRaw as Array<Record<string, unknown>>)
        : [];

      return {
        url: location.href,
        hookEventCount: hooks.length,
        instantiatedCount: hooks.filter(entry => entry.type === 'instantiated')
          .length,
        importCallCount: hooks.filter(entry => entry.type === 'import_call')
          .length,
        memoryEventCount: hooks.filter(entry => entry.type === 'memory_created')
          .length,
        storageCount: Array.isArray(win.__wasmModuleStorage)
          ? win.__wasmModuleStorage.length
          : 0,
        instanceCount: Array.isArray(win.__wasmInstances)
          ? win.__wasmInstances.length
          : 0,
      };
    });
    const available =
      probe.instantiatedCount > 0 ||
      probe.memoryEventCount > 0 ||
      probe.storageCount > 0 ||
      probe.instanceCount > 0;
    pageCapability = {
      capability: 'wasm_browser_capture_current_page',
      status: available ? 'available' : 'unavailable',
      reason: available
        ? undefined
        : 'No captured WASM modules or exported memory are visible on the current page.',
      fix: available
        ? undefined
        : 'Load a page that instantiates WASM and inject the webassembly-full hook before navigation.',
      details: {
        tools: ['wasm_dump', 'wasm_vmp_trace', 'wasm_memory_inspect'],
        pageAttached: true,
        ...probe,
      },
    };
  } catch (error) {
    pageCapability = {
      capability: 'wasm_browser_capture_current_page',
      status: 'unknown',
      reason: `Current page probe failed: ${error instanceof Error ? error.message : String(error)}`,
      fix: 'Attach or launch a browser page before using browser-backed WASM tools.',
      details: {
        tools: ['wasm_dump', 'wasm_vmp_trace', 'wasm_memory_inspect'],
        pageAttached: false,
      },
    };
  }

  const hasOfflineRuntime =
    probes['runtime.wasmtime'].available || probes['runtime.wasmer'].available;

  return {
    success: true,
    tooltype: 'wasm_capabilities',
    capabilities: [
      pageCapability,
      toolCapability(
        'wabt_wasm2wat',
        'wabt.wasm2wat',
        ['wasm_disassemble'],
        'Install WABT so wasm2wat is available on PATH.',
        probes,
      ),
      toolCapability(
        'wabt_wasm_decompile',
        'wabt.wasm-decompile',
        ['wasm_decompile'],
        'Install WABT so wasm-decompile is available on PATH.',
        probes,
      ),
      toolCapability(
        'wabt_wasm_objdump',
        'wabt.wasm-objdump',
        ['wasm_inspect_sections'],
        'Install WABT so wasm-objdump is available on PATH.',
        probes,
      ),
      toolCapability(
        'binaryen_wasm_opt',
        'binaryen.wasm-opt',
        ['wasm_optimize'],
        'Install Binaryen so wasm-opt is available on PATH.',
        probes,
      ),
      {
        capability: 'wasm_offline_runtime',
        status: hasOfflineRuntime ? 'available' : 'unavailable',
        reason: hasOfflineRuntime
          ? undefined
          : 'No offline WASM runtime is available on PATH.',
        fix: hasOfflineRuntime
          ? undefined
          : 'Install wasmtime or wasmer to enable wasm_offline_run.',
        details: {
          tools: ['wasm_offline_run'],
          runtimes: {
            wasmtime: probes['runtime.wasmtime'],
            wasmer: probes['runtime.wasmer'],
          },
          preferredRuntime: probes['runtime.wasmtime'].available
            ? 'runtime.wasmtime'
            : probes['runtime.wasmer'].available
              ? 'runtime.wasmer'
              : null,
        },
      },
    ],
  };
}

function toolCapability(
  capability: string,
  toolName: WasmToolName,
  tools: string[],
  fix: string,
  probes: Record<WasmToolName, ProbeResult>,
) {
  const probe = probes[toolName];
  return {
    capability,
    status: probe.available ? 'available' : 'unavailable',
    reason: probe.available ? undefined : probe.reason,
    fix: probe.available ? undefined : fix,
    details: {
      tools,
      path: probe.path,
      version: probe.version,
      backend: toolName,
    },
  };
}

export async function wasmDump(args: Args = {}) {
  const moduleIndex = argNumber(args, 'moduleIndex', 0);
  const outputPath = argString(args, 'outputPath');
  const page = await getActivePage();

  const result: WasmDumpEvalResult = await page.evaluate((idx: number) => {
    const win = window as unknown as {__aiHooks?: Record<string, unknown>};
    const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
    if (!Array.isArray(hooksRaw) || hooksRaw.length === 0) {
      return {
        error:
          'No WASM modules captured. Ensure the webassembly-full hook preset is active and the page has loaded WASM.',
      };
    }

    const hooks = hooksRaw as Array<Record<string, unknown>>;
    const instantiatedEvents = hooks.filter(e => e.type === 'instantiated');
    if (idx >= instantiatedEvents.length) {
      return {
        error: `Module index ${idx} out of range. Found ${instantiatedEvents.length} instantiated modules.`,
      };
    }

    const event = instantiatedEvents[idx]!;
    return {
      exports: event.exports,
      importMods: event.importMods,
      size: event.size,
      moduleCount: instantiatedEvents.length,
    };
  }, moduleIndex);

  if (hasErrorResult(result)) {
    return {success: false, tooltype: 'wasm_dump', error: result.error};
  }

  const wasmBytes = await page.evaluate((idx: number) => {
    const win = window as unknown as {__wasmModuleStorage?: unknown[]};
    const storage = win.__wasmModuleStorage;
    if (!storage?.[idx]) {
      return null;
    }
    const buffer = storage[idx] as ArrayBufferLike;
    return Array.from(new Uint8Array(buffer));
  }, moduleIndex);

  let artifactPath: string;
  let hash: string | undefined;

  if (wasmBytes) {
    const buffer = Buffer.from(wasmBytes as number[]);
    hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    if (outputPath) {
      artifactPath = validateOutputPath(outputPath);
    } else {
      const artifact = await resolveArtifactPath({
        toolName: 'wasm-dump',
        target: hash,
        ext: 'wasm',
      });
      artifactPath = artifact.displayPath;
      await writeFile(artifact.absolutePath, buffer);
      return {
        success: true,
        tooltype: 'wasm_dump',
        artifactPath,
        hash,
        size: result.size,
        exports: result.exports,
        importModules: result.importMods,
        totalModules: result.moduleCount,
        hint: 'Use wasm_disassemble or wasm_decompile on the dumped file for further analysis.',
      };
    }
    await writeFile(artifactPath, buffer);
  } else {
    artifactPath = '(binary not available - hook did not store raw bytes)';
  }

  return {
    success: true,
    tooltype: 'wasm_dump',
    artifactPath,
    hash,
    size: result.size,
    exports: result.exports,
    importModules: result.importMods,
    totalModules: result.moduleCount,
    hint: wasmBytes
      ? 'Use wasm_disassemble or wasm_decompile on the dumped file for further analysis.'
      : 'Binary not captured. Inject the webassembly-full hook before page navigation with module storage enabled.',
  };
}

export async function wasmDisassemble(
  args: Args = {},
) {
  const inputPath = argRequiredString(args, 'inputPath');
  const outputPath = argString(args, 'outputPath');
  const foldExprs = argBool(args, 'foldExprs', true);
  const toolArgs = [inputPath];
  if (foldExprs) {
    toolArgs.push('--fold-exprs');
  }

  const result = await runExternalTool('wabt.wasm2wat', toolArgs);
  if (!result.ok) {
    return externalFailure('wasm_disassemble', result);
  }

  const artifactPath = await writeTextArtifact(
    'wasm-disassemble',
    'wat',
    result.stdout,
    outputPath,
  );
  const preview = textPreview(result.stdout, 50);

  return {
    success: true,
    tooltype: 'wasm_disassemble',
    artifactPath,
    totalLines: preview.totalLines,
    sizeBytes: result.stdout.length,
    preview: preview.preview,
    durationMs: result.durationMs,
    truncated: result.truncated,
  };
}

export async function wasmDecompile(
  args: Args = {},
) {
  const inputPath = argRequiredString(args, 'inputPath');
  const outputPath = argString(args, 'outputPath');
  const result = await runExternalTool('wabt.wasm-decompile', [inputPath]);
  if (!result.ok) {
    return externalFailure('wasm_decompile', result);
  }

  const artifactPath = await writeTextArtifact(
    'wasm-decompile',
    'dcmp',
    result.stdout,
    outputPath,
  );
  const preview = textPreview(result.stdout, 60);

  return {
    success: true,
    tooltype: 'wasm_decompile',
    artifactPath,
    totalLines: preview.totalLines,
    preview: preview.preview,
    durationMs: result.durationMs,
    truncated: result.truncated,
  };
}

export async function wasmInspectSections(
  args: Args = {},
) {
  const inputPath = argRequiredString(args, 'inputPath');
  const sections = argString(args, 'sections', 'details');
  const flagMap: Record<string, string[]> = {
    headers: ['-h'],
    details: ['-x'],
    disassemble: ['-d'],
    all: ['-h', '-x', '-d'],
  };
  const result = await runExternalTool('wabt.wasm-objdump', [
    ...(flagMap[sections ?? 'details'] ?? ['-x']),
    inputPath,
  ]);

  if (!result.ok) {
    return externalFailure('wasm_inspect_sections', result);
  }

  const preview = textPreview(result.stdout, 100);
  return {
    success: true,
    tooltype: 'wasm_inspect_sections',
    totalLines: preview.totalLines,
    preview: preview.preview,
    durationMs: result.durationMs,
    truncated: result.truncated,
  };
}

export async function wasmOfflineRun(
  args: Args = {},
) {
  const inputPath = argRequiredString(args, 'inputPath');
  const functionName = argRequiredString(args, 'functionName');
  const fnArgs = argStringArray(args, 'args');
  const runtime = argString(args, 'runtime', 'auto');
  const timeoutMs = argNumber(args, 'timeoutMs', 10_000);

  let toolName: 'runtime.wasmtime' | 'runtime.wasmer';
  if (runtime === 'auto') {
    const probes = await probeAllTools();
    if (probes['runtime.wasmtime'].available) {
      toolName = 'runtime.wasmtime';
    } else if (probes['runtime.wasmer'].available) {
      toolName = 'runtime.wasmer';
    } else {
      return {
        success: false,
        tooltype: 'wasm_offline_run',
        error: 'No WASM runtime found. Install wasmtime or wasmer.',
      };
    }
  } else {
    toolName = runtime === 'wasmer' ? 'runtime.wasmer' : 'runtime.wasmtime';
  }

  const runArgs =
    toolName === 'runtime.wasmtime'
      ? ['run', '--invoke', functionName, inputPath, ...fnArgs]
      : ['run', inputPath, '--invoke', functionName, '--', ...fnArgs];
  const result = await runExternalTool(toolName, runArgs, timeoutMs);

  return {
    success: result.ok,
    tooltype: 'wasm_offline_run',
    runtime: toolName,
    functionName,
    args: fnArgs,
    output: result.stdout.trim(),
    stderr: result.stderr.trim() || undefined,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  };
}

export async function wasmOptimize(
  args: Args = {},
) {
  const inputPath = argRequiredString(args, 'inputPath');
  const outputPath = argString(args, 'outputPath');
  const level = argString(args, 'level', 'O2') ?? 'O2';
  const destination = outputPath
    ? validateOutputPath(outputPath)
    : (
        await resolveArtifactPath({
          toolName: 'wasm-opt',
          ext: 'wasm',
        })
      ).absolutePath;

  const result = await runExternalTool(
    'binaryen.wasm-opt',
    [`-${level}`, inputPath, '-o', destination],
    WASM_OPTIMIZE_TIMEOUT_MS,
  );

  if (!result.ok) {
    return externalFailure('wasm_optimize', result);
  }

  let inputSize = 0;
  let outputSize = 0;
  try {
    inputSize = (await stat(inputPath)).size;
    outputSize = (await stat(destination)).size;
  } catch {
    // Ignore stat errors; optimization already succeeded.
  }

  return {
    success: true,
    tooltype: 'wasm_optimize',
    artifactPath: relative(projectRoot(), destination).replace(/\\/g, '/'),
    optimizationLevel: level,
    inputSizeBytes: inputSize,
    outputSizeBytes: outputSize,
    reductionPercent:
      inputSize > 0 ? ((1 - outputSize / inputSize) * 100).toFixed(1) : '0',
    durationMs: result.durationMs,
  };
}

export async function wasmVmpTrace(
  args: Args = {},
) {
  const maxEvents = argNumber(args, 'maxEvents', 5000);
  const filterModule = argString(args, 'filterModule');
  const page = await getActivePage();

  const traceData: WasmVmpTraceEvalResult = await page.evaluate(
    (opts: {maxEvents: number; filterModule?: string}) => {
      const win = window as unknown as {__aiHooks?: Record<string, unknown>};
      const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
      if (!Array.isArray(hooksRaw) || hooksRaw.length === 0) {
        return {
          error:
            'No WASM hook data. Inject the webassembly-full hook and reload the page.',
        };
      }

      const hooks = hooksRaw as Array<Record<string, unknown>>;
      let importCalls = hooks.filter(e => e.type === 'import_call');
      if (opts.filterModule) {
        importCalls = importCalls.filter(e => e.mod === opts.filterModule);
      }

      const limited = importCalls.slice(0, opts.maxEvents);
      const fnCounts: Record<string, number> = {};
      for (const call of limited) {
        const key = `${String(call.mod)}.${String(call.fn)}`;
        fnCounts[key] = (fnCounts[key] || 0) + 1;
      }

      const topFunctions = Object.entries(fnCounts)
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([name, count]) => ({name, count}));

      return {
        totalEvents: importCalls.length,
        capturedEvents: limited.length,
        topFunctions,
        trace: limited.slice(0, 200).map(e => ({
          mod: e.mod,
          fn: e.fn,
          args: e.args,
          ts: e.ts,
        })),
      };
    },
    {maxEvents, filterModule},
  );

  if (hasErrorResult(traceData)) {
    return {
      success: false,
      tooltype: 'wasm_vmp_trace',
      error: traceData.error,
    };
  }

  return {
    success: true,
    tooltype: 'wasm_vmp_trace',
    ...traceData,
    hint: 'Top functions show VMP handler dispatch patterns. Use wasm_disassemble to analyze their implementation.',
  };
}

export async function wasmMemoryInspect(
  args: Args = {},
) {
  const offset = argNumber(args, 'offset', 0);
  const length = Math.min(argNumber(args, 'length', 256), 65_536);
  const format = argString(args, 'format', 'both');
  const searchPattern = argString(args, 'searchPattern');
  const page = await getActivePage();

  const memData: WasmMemoryInspectEvalResult = await page.evaluate(
    (opts: {offset: number; length: number; searchPattern?: string}) => {
      const win = window as unknown as {
        __wasmInstances?: unknown[];
      };
      const instances = win.__wasmInstances;
      if (!Array.isArray(instances) || instances.length === 0) {
        return {
          error:
            'No WASM memory available. Ensure the webassembly-full hook is active and a WASM module is instantiated.',
        };
      }

      try {
        const firstInstance = instances[0] as {
          exports?: {memory?: {buffer?: ArrayBufferLike}};
        };
        const memory = firstInstance.exports?.memory;
        if (!memory?.buffer) {
          return {error: 'WASM module has no exported memory.'};
        }

        const buffer = new Uint8Array(memory.buffer);
        const data = Array.from(
          buffer.slice(opts.offset, opts.offset + opts.length),
        );
        let searchResults: Array<{offset: number}> | undefined;

        if (opts.searchPattern) {
          searchResults = [];
          const isHex = /^[0-9a-fA-F\s]+$/.test(opts.searchPattern);
          const patternBytes = isHex
            ? (opts.searchPattern
                .replace(/\s/g, '')
                .match(/.{2}/g)
                ?.map(hex => parseInt(hex, 16)) ?? [])
            : Array.from(new TextEncoder().encode(opts.searchPattern));

          for (
            let i = opts.offset;
            i <=
            Math.min(
              opts.offset + opts.length - patternBytes.length,
              buffer.length - patternBytes.length,
            );
            i++
          ) {
            let match = true;
            for (let j = 0; j < patternBytes.length; j++) {
              if (buffer[i + j] !== patternBytes[j]) {
                match = false;
                break;
              }
            }
            if (match) {
              searchResults.push({offset: i});
            }
          }
        }

        return {
          totalMemoryPages: memory.buffer.byteLength / 65_536,
          totalMemoryBytes: memory.buffer.byteLength,
          data,
          searchResults,
        };
      } catch (error) {
        return {
          error: `Failed to read WASM memory: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
    {offset, length, searchPattern},
  );

  if (hasErrorResult(memData)) {
    return {
      success: false,
      tooltype: 'wasm_memory_inspect',
      error: memData.error,
    };
  }

  const data = memData.data;
  let hexDump = '';
  let asciiDump = '';

  if (format === 'hex' || format === 'both') {
    for (let i = 0; i < data.length; i += 16) {
      const row = data.slice(i, i + 16);
      const addr = (offset + i).toString(16).padStart(8, '0');
      const hex = row.map(byte => byte.toString(16).padStart(2, '0')).join(' ');
      const ascii = row
        .map(byte =>
          byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.',
        )
        .join('');
      hexDump += `${addr}  ${hex.padEnd(48)}  |${ascii}|\n`;
    }
  }

  if (format === 'ascii') {
    asciiDump = data
      .map(byte =>
        byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.',
      )
      .join('');
  }

  return {
    success: true,
    tooltype: 'wasm_memory_inspect',
    totalMemoryPages: memData.totalMemoryPages,
    totalMemoryBytes: memData.totalMemoryBytes,
    offset,
    length: data.length,
    hexDump: format !== 'ascii' ? hexDump : undefined,
    asciiDump: format === 'ascii' ? asciiDump : undefined,
    searchResults: memData.searchResults,
  };
}

async function writeTextArtifact(
  toolName: string,
  ext: string,
  content: string,
  outputPath?: string,
) {
  if (outputPath) {
    const safePath = validateOutputPath(outputPath);
    await writeFile(safePath, content, 'utf-8');
    return safePath;
  }
  const artifact = await resolveArtifactPath({toolName, ext});
  await writeFile(artifact.absolutePath, content, 'utf-8');
  return artifact.displayPath;
}

function externalFailure(tooltype: string, result: RunResult) {
  return {
    success: false,
    tooltype,
    error: result.stderr.trim() || result.stdout.trim(),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  };
}
