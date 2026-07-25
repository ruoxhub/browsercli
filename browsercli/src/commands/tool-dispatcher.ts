/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';
import path from 'node:path';

import {getBoolFlag, getFlag, parseArgs, type ParsedArgs} from '../args-parser.js';
import {successOutput} from '../output.js';
import type {ToolMeta} from '../tool-meta-types.js';
import type {WorkerContext} from '../types.js';
import {WorkerHttpClient} from '../WorkerHttpClient.js';

import {buildToolArgs} from './shared/tool-args.js';

/**
 * 当请求的工具名模糊匹配到多个候选（如 `select` → select_frame / select_page）
 * 时，用用户实际提供的 flag 做参数消歧：命中参数名最多的候选胜出。
 * 仅在存在唯一最优且确有命中时才采用，否则返回 undefined（交由上层报错）。
 */
function disambiguateByArgs(
  candidates: ToolMeta[],
  parsed: ParsedArgs,
): ToolMeta | undefined {
  const providedKeys = Object.keys(parsed.flags)
    .filter(k => k !== 'file' && k !== 'data' && k !== 'stdin')
    .map(k => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

  const scored = candidates
    .map(tool => {
      const specKeys = Object.keys(tool.argSpecs ?? {});
      const hit = providedKeys.filter(k => specKeys.includes(k)).length;
      return {tool, hit};
    })
    .sort((a, b) => b.hit - a.hit);

  if (
    scored[0] &&
    scored[0].hit > 0 &&
    (scored.length === 1 || scored[0].hit > scored[1].hit)
  ) {
    return scored[0].tool;
  }
  return undefined;
}

export const toolDispatcherCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const requestedName = parsed.positionals[0];

  if (!requestedName) {
    throw new AxiError('缺少工具名称', 'VALIDATION_ERROR', [
      `用法：browsercli call <tool-name> [--param value] [--url <url>] [--data <json>] [--file <path>]`,
    ]);
  }

  const httpClient = ctx?.httpClient;
  if (!httpClient) {
    throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');
  }

  // 通过 GET /api/v1/tools 解析工具名 + 提供候选建议
  const listed = await httpClient.listTools();
  const allTools = listed.tools as ToolMeta[];
  const normalizedName = requestedName.replaceAll('-', '_');
  let candidate =
    allTools.find(t => t.name === requestedName) ??
    allTools.find(t => t.name === normalizedName);

  if (!candidate) {
    // 子串候选：requestedName 是某个工具名的一部分（如 `select` 同时是
    // select_frame / select_page 的前缀）。单个候选直接采用；多个候选时
    // 用用户提供的 flag 做参数消歧，命中参数最多的工具胜出。
    const subs = allTools.filter(t => t.name.includes(normalizedName));
    if (subs.length === 1) {
      candidate = subs[0];
    } else if (subs.length > 1) {
      candidate = disambiguateByArgs(subs, parsed);
    }
  }

  if (!candidate) {
    const suggestions = allTools
      .map(t => t.name)
      .filter(name => name.includes(normalizedName))
      .slice(0, 5);
    throw new AxiError(
      `未知工具：${requestedName}`,
      'UNKNOWN_TOOL',
      suggestions,
    );
  }

  const toolArgs = buildToolArgs(parsed, candidate.argSpecs);

  // 人体工学：支持 `call evaluate_script "<fn>"` 式的位置参数，
  // 对齐 chrome-devtools 的 `evaluate_script "<fn>"` 调用方式。
  // positionals[0] 是工具名本身，函数体位于其后的剩余位置参数。
  // 同时处理 consumeFlagValue 将 --function 误设为 true（下一参数以 '-' 开头）的情况。
  if (
    (toolArgs.function === undefined || toolArgs.function === true) &&
    parsed.positionals.length > 1 &&
    candidate.argSpecs?.function?.type === 'string'
  ) {
    toolArgs.function = parsed.positionals.slice(1).join(' ');
  }

  // get_script_source / search_in_sources 默认把源码保存到当前工作目录（pwd）。
  // - get_script_source：filePath 为文件，文件名取脚本 ID（<pwd>/<scriptId>.js）。
  // - search_in_sources：filePath 为目录，每个匹配脚本写入 <pwd>/<scriptId>.js。
  // 调用方仍可用 --file-path 显式覆盖保存位置。
  if (toolArgs.filePath === undefined) {
    if (candidate.name === 'get_script_source') {
      const scriptId = String(toolArgs.scriptId ?? 'script');
      toolArgs.filePath = path.join(process.cwd(), `${scriptId}.js`);
    } else if (candidate.name === 'search_in_sources') {
      toolArgs.filePath = process.cwd();
    }
  }

  try {
    const sessionId = getFlag(parsed, 'session'); // string | undefined
    const result = await httpClient.invoke(sessionId, candidate.name, toolArgs);

    // --watch：订阅该会话事件流（非致命：流不可用时仅告警）
    if (getBoolFlag(parsed, 'watch')) {
      try {
        const close = await httpClient.openStream(sessionId, ev =>
          console.log('[stream]', JSON.stringify(ev)),
        );
        process.once('exit', close);
      } catch (streamErr) {
        console.warn(
          '[call] --watch 流不可用:',
          streamErr instanceof Error ? streamErr.message : streamErr,
        );
      }
    }

    return successOutput({
      command: 'call',
      target: requestedName,
      tool: candidate.name,
      result,
    });
  } catch (error) {
    if (error instanceof AxiError) throw error;
    throw new AxiError(
      `工具调用失败：${error instanceof Error ? error.message : error}`,
      'TOOL_INVOCATION_ERROR',
    );
  }
};
