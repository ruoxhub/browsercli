/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {getBoolFlag, getFlag, parseArgs} from '../args-parser.js';
import {successOutput} from '../output.js';
import {validateToolArgs} from '../tool-arg-validator.js';
import {ensureToolsMeta, getToolMeta, searchTools} from '../tools-meta.js';
import type {WorkerHttpClient} from '../WorkerHttpClient.js';
import type {WorkerContext} from '../types.js';

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

  await ensureToolsMeta();
  const normalizedName = requestedName.includes('-')
    ? requestedName.replaceAll('-', '_')
    : requestedName;
  const meta = getToolMeta(requestedName) ?? getToolMeta(normalizedName);

  if (!meta) {
    const suggestions = (await searchTools(requestedName))
      .map(t => t.name)
      .slice(0, 5);
    throw new AxiError(
      `未知工具：${requestedName}`,
      'UNKNOWN_TOOL',
      suggestions,
    );
  }

  const toolArgs = buildToolArgs(parsed, meta);

  try {
    const useHttp = ctx?.transport === 'http' && ctx?.httpClient;
    const validatedArgs = validateToolArgs(meta.name, toolArgs);
    if (validatedArgs.ok === false) {
      throw new AxiError(validatedArgs.error, 'VALIDATION_ERROR');
    }

    let result: unknown;
    if (useHttp) {
      const httpClient = ctx.httpClient as WorkerHttpClient;
      const sessionId = getFlag(parsed, 'session'); // string | undefined
      result = await httpClient.invoke(
        sessionId,
        meta.name,
        validatedArgs.value,
      );
      // --watch：订阅该会话事件流（服务端 /stream 端点由后续任务挂载；
      // 若端点不可用，openStream 会 reject，这里 catch 仅告警不中断主结果）。
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
    } else {
      const invoker = ctx?.invoker;
      const group = ctx?.group;
      if (!invoker || !group) {
        throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');
      }
      result = await invoker.invoke(group, meta.name, validatedArgs.value);
    }

    return successOutput({
      command: 'call',
      target: requestedName,
      tool: meta.name,
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
