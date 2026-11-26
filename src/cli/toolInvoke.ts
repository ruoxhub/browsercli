/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 统一工具调用管线：供一级 `<tool>` 命令与 `call <tool>` 共用。
 * 优先命中构建期静态 `tools-manifest.json`（ADR-0009），未命中再回退 `tools.list` RPC。
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';

import {applyPositionalArgs} from './cliCommands.js';
import type {DaemonLike} from './daemonClient.js';
import {resolveDeprecatedToolHint} from './deprecatedHints.js';
import {
  formatToolResponse,
  isOutputFormat,
  type OutputFormat,
} from './formatResponse.js';
import type {ToolArgSpec, ToolArgSpecMap, ToolMeta} from './tool-meta-types.js';
import {loadStaticToolsManifest} from './tools-manifest-loader.js';

export class CliError extends Error {
  constructor(
    message: string,
    readonly code = 'CLI_ERROR',
    readonly suggestions?: string[],
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export const BUSY_RETRY_DELAYS_MS = [200, 500, 1000];
export const BROWSER_CONNECT_WAIT_TIMEOUT_MS = 15_000;
export const BROWSER_CONNECT_POLL_INTERVAL_MS = 500;
export const WATCH_CHANNELS = [
  'tool.invoke',
  'hook.event',
  'hook.sample',
  'log',
];

export const TOOL_CONTROL_FLAGS: ReadonlySet<string> = new Set([
  '_',
  '$0',
  's',
  'session',
  'file',
  'data',
  'stdin',
  'watch',
  'json',
  'toon',
  'output-format',
  'outputFormat',
  'help',
  'h',
  'version',
]);

export interface ToolControlFlags {
  file?: string;
  data?: string;
  stdin?: boolean;
  watch?: boolean;
  json?: boolean;
  toon?: boolean;
  outputFormat?: string;
}

export interface InvokeToolInput {
  toolName: string;
  rawFlags: Record<string, unknown>;
  positionals?: string[];
  controlFlags?: ToolControlFlags;
  defaultOutputFormat?: string;
  connect: () => Promise<DaemonLike>;
}

export interface InvokeToolOutput {
  tool: string;
  result: unknown;
  format: OutputFormat;
  rendered: string;
}

function toCamelCase(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function maybeParseJsonLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  const looksLikeJson =
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'));
  if (!looksLikeJson) return raw;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function tryParseJsonObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function coerceValue(raw: unknown, spec?: ToolArgSpec): unknown {
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') {
    return raw === true && spec?.type === 'string' ? undefined : raw;
  }
  if (typeof raw === 'number') {
    return spec?.type === 'string' ? String(raw) : raw;
  }
  if (Array.isArray(raw)) {
    if (spec?.type === 'string') return raw.map(String).join(' ');
    if (
      spec?.type === 'string[]' &&
      raw.length === 1 &&
      typeof raw[0] === 'string'
    ) {
      const parsed = maybeParseJsonLiteral(raw[0]);
      if (Array.isArray(parsed)) return parsed.map(String);
    }
    return raw;
  }
  if (typeof raw !== 'string') return raw;

  if (spec?.type === 'string') return raw;
  if (spec?.type === 'boolean') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return raw;
  }
  if (spec?.type === 'number') {
    return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  if (spec?.type === 'string[]') {
    const parsed = maybeParseJsonLiteral(raw);
    return Array.isArray(parsed) ? parsed : raw;
  }
  if (spec?.type === 'object') {
    const parsed = maybeParseJsonLiteral(raw);
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? parsed
      : raw;
  }

  const parsed = maybeParseJsonLiteral(raw);
  if (parsed !== raw) return parsed;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * 构建工具调用参数对象。优先级（高 → 低）：CLI flags > --data > --file > --stdin。
 */
export function buildToolArgs(
  rawFlags: Record<string, unknown>,
  argSpecs?: ToolArgSpecMap,
  controlFlags: ToolControlFlags = {},
): Record<string, unknown> {
  const toolArgs: Record<string, unknown> = {};

  if (controlFlags.stdin === true && !process.stdin.isTTY) {
    try {
      const stdinArgs = tryParseJsonObject(readFileSync(0, 'utf8'));
      if (stdinArgs) Object.assign(toolArgs, stdinArgs);
    } catch {
      // ignore unreadable stdin
    }
  }

  if (typeof controlFlags.file === 'string' && controlFlags.file.length > 0) {
    const resolved = path.resolve(controlFlags.file);
    const ext = path.extname(resolved).toLowerCase();
    const content = readFileSync(resolved, 'utf8');
    if (ext === '.js' || ext === '.mjs' || ext === '.ts') {
      toolArgs.function = content;
    } else {
      try {
        Object.assign(toolArgs, JSON.parse(content) as Record<string, unknown>);
      } catch {
        throw new CliError(
          `--file 参数指定的文件 ${resolved} 不是有效的 JSON`,
          'VALIDATION_ERROR',
        );
      }
    }
  }

  if (controlFlags.data !== undefined) {
    if (
      typeof controlFlags.data !== 'string' ||
      controlFlags.data.length === 0
    ) {
      throw new CliError(
        '--data 参数必须是非空 JSON 字符串',
        'VALIDATION_ERROR',
      );
    }
    const parsed = tryParseJsonObject(controlFlags.data);
    if (!parsed) {
      throw new CliError(
        `--data 参数不是有效的 JSON 对象：${controlFlags.data.slice(0, 80)}`,
        'VALIDATION_ERROR',
      );
    }
    Object.assign(toolArgs, parsed);
  }

  // yargs 会同时产出 kebab-case 和 camelCase 两个键；去重后按 camelCase 写入。
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(rawFlags)) {
    if (TOOL_CONTROL_FLAGS.has(key) || value === undefined) continue;
    const argKey = toCamelCase(key);
    if (seen.has(argKey)) continue;
    seen.add(argKey);
    const coerced = coerceValue(value, argSpecs?.[argKey]);
    if (coerced !== undefined) {
      toolArgs[argKey] = coerced;
    }
  }

  return toolArgs;
}

export async function invokeWithBusyRetry(
  client: DaemonLike,
  tool: string,
  params: Record<string, unknown>,
  delays: number[] = BUSY_RETRY_DELAYS_MS,
  connectTimeoutMs = BROWSER_CONNECT_WAIT_TIMEOUT_MS,
  connectPollMs = BROWSER_CONNECT_POLL_INTERVAL_MS,
): Promise<unknown> {
  const startTime = Date.now();
  let busyAttempt = 0;
  for (;;) {
    try {
      return await client.request('tool.invoke', {tool, params});
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/WORKER_BUSY/.test(msg) && /browser connect/.test(msg)) {
        if (Date.now() - startTime < connectTimeoutMs) {
          await new Promise(r => setTimeout(r, connectPollMs));
          continue;
        }
        throw err;
      }
      if (busyAttempt < delays.length && /WORKER_BUSY/.test(msg)) {
        await new Promise(r => setTimeout(r, delays[busyAttempt]));
        busyAttempt += 1;
        continue;
      }
      throw err;
    }
  }
}

export function matchToolCandidate(
  tools: ToolMeta[],
  requestedName: string,
  rawFlags: Record<string, unknown>,
): ToolMeta | undefined {
  const normalized = requestedName.replaceAll('-', '_');
  const exact =
    tools.find(t => t.name === requestedName) ??
    tools.find(t => t.name === normalized) ??
    tools.find(
      t =>
        t.aliases?.includes(requestedName) || t.aliases?.includes(normalized),
    );
  if (exact) return exact;

  const subs = tools.filter(t => t.name.includes(normalized));
  if (subs.length === 1) return subs[0];
  if (subs.length > 1) {
    const provided = Object.keys(rawFlags)
      .filter(k => !TOOL_CONTROL_FLAGS.has(k))
      .map(toCamelCase);
    const scored = subs
      .map(tool => {
        const specKeys = Object.keys(tool.argSpecs ?? {});
        return {tool, hit: provided.filter(k => specKeys.includes(k)).length};
      })
      .sort((a, b) => b.hit - a.hit);
    if (
      scored[0] &&
      scored[0].hit > 0 &&
      (scored.length === 1 || scored[0].hit > scored[1].hit)
    ) {
      return scored[0].tool;
    }
  }
  return undefined;
}

function extractToolFailure(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as {
    structuredContent?: Record<string, unknown>;
    isError?: unknown;
    content?: Array<{type?: unknown; text?: unknown}>;
  };
  if (r.structuredContent && r.structuredContent.success === false) {
    return typeof r.structuredContent.message === 'string' &&
      r.structuredContent.message
      ? r.structuredContent.message
      : '工具返回失败状态';
  }
  if (r.isError === true) {
    const firstText = Array.isArray(r.content)
      ? r.content.find(c => c?.type === 'text' && typeof c.text === 'string')
      : undefined;
    return (firstText?.text as string | undefined) || '工具返回错误状态';
  }
  return undefined;
}

/**
 * 解析最终输出格式。
 * 优先级（高 → 低）：--output-format > --json/--toon > BROWSERCLI_OUTPUT_FORMAT > config.outputFormat > 'toon'。
 */
export function resolveOutputFormat(
  controlFlags: ToolControlFlags = {},
  defaultOutputFormat?: string,
): OutputFormat {
  if (controlFlags.outputFormat !== undefined) {
    if (!isOutputFormat(controlFlags.outputFormat)) {
      throw new CliError(
        `无效的 --output-format 值：${controlFlags.outputFormat}（支持 md、json 或 toon）`,
        'VALIDATION_ERROR',
      );
    }
    return controlFlags.outputFormat;
  }

  if (controlFlags.json && controlFlags.toon) {
    throw new CliError('--json 与 --toon 不能同时使用', 'VALIDATION_ERROR');
  }
  if (controlFlags.json) return 'json';
  if (controlFlags.toon) return 'toon';

  const envFormat = process.env.BROWSERCLI_OUTPUT_FORMAT?.trim();
  if (envFormat) {
    if (!isOutputFormat(envFormat)) {
      throw new CliError(
        `无效的 BROWSERCLI_OUTPUT_FORMAT 值：${envFormat}（支持 md、json 或 toon）`,
        'VALIDATION_ERROR',
      );
    }
    return envFormat;
  }

  const cfgFormat = defaultOutputFormat?.trim();
  if (cfgFormat) {
    if (!isOutputFormat(cfgFormat)) {
      throw new CliError(
        `配置文件中的 outputFormat 无效：${cfgFormat}（支持 md、json 或 toon）`,
        'VALIDATION_ERROR',
      );
    }
    return cfgFormat;
  }

  return 'toon';
}

export async function invokeTool(
  input: InvokeToolInput,
): Promise<InvokeToolOutput> {
  const {
    toolName,
    rawFlags,
    positionals = [],
    controlFlags = {},
    defaultOutputFormat,
    connect,
  } = input;
  if (!toolName) {
    throw new CliError('缺少工具名称', 'VALIDATION_ERROR', [
      '用法：browsercli <tool-name> [...args] [--param value]',
    ]);
  }

  const deprecatedReplacement = resolveDeprecatedToolHint(toolName);
  if (deprecatedReplacement) {
    throw new CliError(
      `工具 '${toolName}' 已废弃，请改用 '${deprecatedReplacement}'。`,
      'COMMAND_DEPRECATED',
      [`请使用替代命令: ${deprecatedReplacement}`],
    );
  }

  const format = resolveOutputFormat(controlFlags, defaultOutputFormat);

  const staticTools = loadStaticToolsManifest()?.tools ?? [];
  let candidate = matchToolCandidate(staticTools, toolName, rawFlags);

  const client = await connect();
  try {
    if (!candidate) {
      const listed = await client.request<{tools?: unknown[]}>('tools.list');
      const allTools = (
        Array.isArray(listed) ? listed : (listed?.tools ?? [])
      ) as ToolMeta[];
      candidate = matchToolCandidate(allTools, toolName, rawFlags);
      if (!candidate) {
        const norm = toolName.replaceAll('-', '_');
        const suggestions = [...allTools, ...staticTools]
          .map(t => t.name)
          .filter((n, idx, arr) => arr.indexOf(n) === idx && n.includes(norm))
          .slice(0, 5);
        throw new CliError(
          `未知工具：${toolName}`,
          'UNKNOWN_TOOL',
          suggestions,
        );
      }
    }

    const toolArgs = buildToolArgs(rawFlags, candidate.argSpecs, controlFlags);

    applyPositionalArgs(
      candidate.name,
      toolArgs,
      positionals,
      candidate.argSpecs,
      coerceValue,
    );

    // get_script_source / search_in_sources 默认保存到当前工作目录
    if (toolArgs.filePath === undefined) {
      if (candidate.name === 'get_script_source') {
        const scriptId = String(toolArgs.scriptId ?? 'script');
        toolArgs.filePath = path.join(process.cwd(), `${scriptId}.js`);
      } else if (candidate.name === 'search_in_sources') {
        toolArgs.filePath = process.cwd();
      }
    }

    if (controlFlags.watch) {
      try {
        await client.request('subscribe', {channels: WATCH_CHANNELS});
        client.onEvent(ev => console.log('[stream]', JSON.stringify(ev)));
      } catch (err) {
        console.warn(
          '[watch] 事件流不可用:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    const result = await invokeWithBusyRetry(client, candidate.name, toolArgs);
    const failure = extractToolFailure(result);
    if (failure) {
      throw new CliError(`工具执行失败：${failure}`, 'TOOL_FAILURE');
    }

    return {
      tool: candidate.name,
      result,
      format,
      rendered: await formatToolResponse(candidate.name, result, format),
    };
  } finally {
    client.close();
  }
}
