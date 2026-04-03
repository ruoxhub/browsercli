/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {sendCommand, handleResponse} from '../daemon/client.js';
import type {CallToolResult} from '../third_party/index.js';

/**
 * CLI 命令解析结果
 */
export interface ParsedArgs {
  command: string;
  tool?: string;
  skill?: string;
  params: Record<string, unknown>;
  outputFormat: 'text' | 'json' | 'md';
}

/**
 * 发送 daemon 的请求格式
 */
export interface DaemonRequest {
  method: string;
  tool?: string;
  skill?: string;
  args?: Record<string, unknown>;
}

/**
 * 解析命令行参数
 */
export function parseCliArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: 'help',
    params: {},
    outputFormat: 'text',
  };

  if (argv.length === 0) {
    return result;
  }

  const args = [...argv];
  result.command = args.shift()!;

  // 处理 call 命令：call <tool> [params...]
  if (result.command === 'call') {
    result.tool = args.shift();
  }

  // 处理 call-skill 命令：call-skill <skill> [params...]
  if (result.command === 'call-skill') {
    result.skill = args.shift();
  }

  // 解析剩余参数
  let pendingKey: string | null = null;
  let i = 0;
  for (const arg of args) {
    if (pendingKey !== null && !arg.startsWith('--')) {
      // 前一个参数是 --key 格式，当前参数是值
      const value = arg;
      if (value === 'true') {
        result.params[pendingKey] = true;
      } else if (value === 'false') {
        result.params[pendingKey] = false;
      } else if (/^\d+$/.test(value)) {
        result.params[pendingKey] = parseInt(value, 10);
      } else {
        result.params[pendingKey] = value;
      }
      pendingKey = null;
      i++;
      continue;
    }

    // 如果还有 pendingKey 且当前参数是 -- 开头，说明前一个是布尔参数
    if (pendingKey !== null) {
      result.params[pendingKey] = true;
      pendingKey = null;
    }

    if (arg.startsWith('--output-format=')) {
      const format = arg.split('=')[1];
      if (format === 'json' || format === 'text' || format === 'md') {
        result.outputFormat = format;
      }
    } else if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        // --key=value 格式
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        // 处理布尔参数
        if (value === 'true') {
          result.params[key] = true;
        } else if (value === 'false') {
          result.params[key] = false;
        } else if (/^\d+$/.test(value)) {
          result.params[key] = parseInt(value, 10);
        } else {
          result.params[key] = value;
        }
      } else {
        // --key 格式，等待下一个参数作为值
        pendingKey = arg.slice(2);
      }
    }
    i++;
  }

  // 处理未完成的 pendingKey（没有值的布尔参数）
  if (pendingKey !== null) {
    result.params[pendingKey] = true;
  }

  return result;
}

/**
 * 构建 daemon 请求
 */
export function buildCommandArgs(parsed: ParsedArgs): DaemonRequest {
  if (parsed.command === 'call') {
    return {
      method: 'invoke_tool',
      tool: parsed.tool,
      args: parsed.params,
    };
  }

  if (parsed.command === 'call-skill') {
    return {
      method: 'invoke_skill',
      skill: parsed.skill,
      args: parsed.params,
    };
  }

  if (parsed.command === 'status') {
    return {method: 'status'};
  }

  if (parsed.command === 'stop') {
    return {method: 'shutdown'};
  }

  return {method: 'help'};
}

/**
 * 主函数 - CLI 入口
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseCliArgs(argv);

  // help 命令显示帮助信息
  if (
    parsed.command === 'help' ||
    parsed.command === '--help' ||
    parsed.command === '-h'
  ) {
    console.log(`
JSReverser-MCP CLI - JavaScript 逆向工程工具

用法:
  js-reverse <command> [选项]

命令:
  start [--headless] [--browserUrl <url>]  启动 daemon
  stop                                      停止 daemon
  status                                    查看状态
  call <tool> [选项]                        调用工具
  call-skill <skill> [选项]                 调用技能

输出格式:
  --output-format=<text|json|md>            设置输出格式 (默认：text)

示例:
  js-reverse call click --uid=abc123
  js-reverse call get_console_messages --output-format=json
  js-reverse call-skill observe-flow --url=https://example.com
`);
    return 0;
  }

  // status 命令
  if (parsed.command === 'status') {
    try {
      const response = await sendCommand({method: 'status'});
      if (response.success) {
        console.log('Daemon 运行中');
        console.log(
          handleResponse(JSON.parse(response.result!), parsed.outputFormat),
        );
        return 0;
      } else {
        console.error('Daemon 未运行');
        return 1;
      }
    } catch (err) {
      console.error('无法连接到 daemon:', (err as Error).message);
      return 1;
    }
  }

  // stop 命令
  if (parsed.command === 'stop') {
    try {
      await sendCommand({method: 'shutdown'});
      console.log('Daemon 已停止');
      return 0;
    } catch (err) {
      console.error('停止失败:', (err as Error).message);
      return 1;
    }
  }

  // call 和 call-skill 命令
  const request = buildCommandArgs(parsed);

  try {
    const response = await sendCommand(request);

    if (!response.success) {
      console.error('错误:', response.error);
      return 1;
    }

    if (response.result) {
      // 尝试解析结果
      try {
        const result: CallToolResult = JSON.parse(response.result);
        console.log(handleResponse(result, parsed.outputFormat));
      } catch {
        // 如果不是 JSON，直接输出
        console.log(response.result);
      }
    }
    return 0;
  } catch (err) {
    console.error('执行失败:', (err as Error).message);
    return 1;
  }
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
