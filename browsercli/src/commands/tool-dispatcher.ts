/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';
import path from 'node:path';

import {getBoolFlag, getFlag, parseArgs} from '../args-parser.js';
import {successOutput} from '../output.js';
import type {ToolMeta} from '../tool-meta-types.js';
import type {WorkerContext} from '../types.js';
import {WorkerHttpClient} from '../WorkerHttpClient.js';

import {buildToolArgs} from './shared/tool-args.js';

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
  const candidate =
    allTools.find(t => t.name === requestedName) ??
    allTools.find(t => t.name === normalizedName);

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

  const toolArgs = buildToolArgs(parsed);

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
