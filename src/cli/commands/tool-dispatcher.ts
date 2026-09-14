/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {getBoolFlag, parseArgs, type ParsedArgs} from '../args-parser.js';
import type {DaemonLike} from '../daemonClient.js';
import {successOutput} from '../output.js';
import type {ToolMeta} from '../tool-meta-types.js';
import type {WorkerContext} from '../types.js';

import {buildToolArgs, TOOL_CONTROL_FLAGS} from './shared/tool-args.js';

/** WORKER_BUSY 退避序列（ms），与旧 submit 重试语义一致 */
export const BUSY_RETRY_DELAYS_MS = [200, 500, 1000];

/** browser connect 忙时的总等待预算（ms），覆盖浏览器冷启动与 CDP 就绪 */
export const BROWSER_CONNECT_WAIT_TIMEOUT_MS = 15_000;
export const BROWSER_CONNECT_POLL_INTERVAL_MS = 500;

/** --watch 订阅的事件频道 */
export const WATCH_CHANNELS = [
  'tool.invoke',
  'hook.event',
  'hook.sample',
  'log',
];

function isWorkerBusyError(err: unknown): boolean {
  return err instanceof Error && /WORKER_BUSY/.test(err.message);
}

function isBrowserConnectBusyError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /WORKER_BUSY/.test(err.message) &&
    /browser connect/.test(err.message)
  );
}

/** tool.invoke + WORKER_BUSY 退避重发 */
export async function invokeWithBusyRetry(
  client: DaemonLike,
  tool: string,
  params: Record<string, unknown>,
  delays: number[] = BUSY_RETRY_DELAYS_MS,
  connectTimeoutMs = BROWSER_CONNECT_WAIT_TIMEOUT_MS,
  connectPollMs = BROWSER_CONNECT_POLL_INTERVAL_MS,
): Promise<unknown> {
  const startTime = Date.now();
  // browser-connect 轮询与 WORKER_BUSY 退避各自计数：轮询 continue 不应消耗
  // 退避预算，否则先经历若干轮询后 attempt 超过 delays.length，退避会被整段跳过。
  let busyAttempt = 0;
  for (;;) {
    try {
      return await client.request('tool.invoke', {tool, params});
    } catch (err) {
      if (isBrowserConnectBusyError(err)) {
        if (Date.now() - startTime < connectTimeoutMs) {
          await new Promise(r => setTimeout(r, connectPollMs));
          continue;
        }
        throw err;
      }
      if (busyAttempt < delays.length && isWorkerBusyError(err)) {
        await new Promise(r => setTimeout(r, delays[busyAttempt]));
        busyAttempt += 1;
        continue;
      }
      throw err;
    }
  }
}

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
    .filter(key => !TOOL_CONTROL_FLAGS.has(key))
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

/**
 * 从 MCP CallToolResult 中提取工具级失败信息：
 * - 项目约定：structuredContent.success === false（优先取其 message）
 * - MCP 标准：isError === true（优先取首个 text content）
 * 成功或非对象结果返回 undefined。
 */
function extractToolFailure(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const callResult = result as {
    structuredContent?: unknown;
    isError?: unknown;
    content?: unknown;
  };

  const structured =
    callResult.structuredContent &&
    typeof callResult.structuredContent === 'object'
      ? (callResult.structuredContent as Record<string, unknown>)
      : undefined;
  if (structured && structured.success === false) {
    return typeof structured.message === 'string' && structured.message
      ? structured.message
      : '工具返回失败状态';
  }

  if (callResult.isError === true) {
    const firstText = Array.isArray(callResult.content)
      ? callResult.content.find(
          (c): c is {type: 'text'; text: string} =>
            !!c &&
            typeof c === 'object' &&
            (c as {type?: unknown}).type === 'text' &&
            typeof (c as {text?: unknown}).text === 'string',
        )
      : undefined;
    return firstText?.text || '工具返回错误状态';
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
      `用法：proxycli call <tool-name> [--param value] [--url <url>] [--data <json>] [--file <path>]`,
    ]);
  }

  if (!ctx) {
    throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');
  }

  const watch = getBoolFlag(parsed, 'watch');
  // 会话路由由 -s/--session 在上下文层完成（createWorkerContext 扫全量 argv）；
  // 命令段的 --session 作为控制 flag 被 buildToolArgs 过滤，不再透传给工具。

  const client = await ctx.connect();
  try {
    // 通过 tools.list 解析工具名 + 提供候选建议
    const listed = await client.request<{tools?: unknown[]}>('tools.list');
    const allTools = (
      Array.isArray(listed) ? listed : (listed?.tools ?? [])
    ) as ToolMeta[];
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

    // --watch 必须先完成订阅，才能观察本次工具调用产生的事件。
    if (watch) {
      try {
        await client.request('subscribe', {channels: WATCH_CHANNELS});
        client.onEvent(ev => console.log('[stream]', JSON.stringify(ev)));
      } catch (streamErr) {
        console.warn(
          '[call] --watch 流不可用:',
          streamErr instanceof Error ? streamErr.message : streamErr,
        );
      }
    }

    const result = await invokeWithBusyRetry(client, candidate.name, toolArgs);

    const failure = extractToolFailure(result);
    if (failure) {
      throw new AxiError(`工具执行失败：${failure}`, 'TOOL_FAILURE');
    }

    if (getBoolFlag(parsed, 'json')) {
      return result as Record<string, unknown>;
    }

    return successOutput(
      {
        command: 'call',
        target: requestedName,
        tool: candidate.name,
        result,
      },
      ctx.session,
    );
  } catch (error) {
    if (error instanceof AxiError) throw error;
    throw new AxiError(
      `工具调用失败：${error instanceof Error ? error.message : error}`,
      'TOOL_INVOCATION_ERROR',
    );
  } finally {
    client.close();
  }
};
