#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as readline from 'node:readline';
import {createInterface} from 'node:readline';
import {sendCommand} from '../daemon/client.js';
import {isDaemonRunning} from '../daemon/utils.js';

const MAX_INPUT_LENGTH = 4096; // 4KB input limit

const HELP_TEXT = `
JS Reverse MCP - REPL 交互模式
=============================

命令:
  help                    显示帮助信息
  skills                  列出所有可用技能
  skill <name> [args...]  调用指定技能
  status                  查看 daemon 状态
  clear                   清屏
  exit, quit, q           退出

技能调用示例:
  skill rebuild-bundle --url https://example.com/app.js
  skill observe-flow --url https://example.com
  skill auto-hook --url https://example.com

提示:
  - 支持命令历史（上下箭头）
  - 支持多行参数
`;

/**
 * 解析用户输入的命令
 */
export function parseCommand(input: string): {command: string; args: string[]} {
  const trimmed = input.trim();
  if (!trimmed) {
    return {command: '', args: []};
  }

  // 简单的分词逻辑，支持 --key value 格式
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  return {command, args};
}

/**
 * 解析技能参数
 */
export function parseSkillArgs(args: string[]): {url?: string; options: Record<string, unknown>} {
  const result: {url?: string; options: Record<string, unknown>} = {
    options: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        if (key === 'url') {
          result.url = value;
        } else {
          result.options[key] = value;
        }
        i++;
      } else {
        result.options[key] = true;
      }
    }
  }

  return result;
}

/**
 * 执行命令
 */
export async function executeCommand(input: string): Promise<string> {
  const {command, args} = parseCommand(input);

  if (!command) {
    return '';
  }

  switch (command) {
    case 'help':
      return HELP_TEXT;

    case 'clear':
      // 清屏由主循环处理
      return '';

    case 'exit':
    case 'quit':
    case 'q':
      return '__EXIT__';

    case 'status': {
      if (!isDaemonRunning()) {
        return '❌ Daemon 未运行，请先启动：js-reverse start';
      }
      const response = await sendCommand({method: 'status'});
      if (response.success && response.result) {
        try {
          const data = JSON.parse(response.result);
          return `✅ Daemon 运行中
   PID: ${data.pid}
   Socket: ${data.socketPath}
   启动时间：${new Date(data.startDate).toLocaleString()}`;
        } catch (parseError) {
          return `❌ 响应解析失败：${parseError instanceof Error ? parseError.message : parseError}`;
        }
      }
      return '❌ 获取状态失败';
    }

    case 'skills': {
      if (!isDaemonRunning()) {
        return '❌ Daemon 未运行，请先启动：js-reverse start';
      }
      const response = await sendCommand({method: 'list_skills'});
      if (response.success && response.result) {
        try {
          const {skills} = JSON.parse(response.result);
          return skills
            .map((s: any) => `  ${s.name} - ${s.description} [${s.category}]`)
            .join('\n');
        } catch (parseError) {
          return `❌ 响应解析失败：${parseError instanceof Error ? parseError.message : parseError}`;
        }
      }
      return '❌ 获取技能列表失败';
    }

    case 'skill': {
      if (args.length === 0) {
        return '❌ 用法：skill <名称> [--url <URL>] [其他参数...]';
      }

      if (!isDaemonRunning()) {
        return '❌ Daemon 未运行，请先启动：js-reverse start';
      }

      const skillName = args[0];
      const {url, options} = parseSkillArgs(args.slice(1));

      const response = await sendCommand({
        method: 'invoke_skill',
        skill: skillName,
        args: {...options, url},
      });

      if (response.success && response.result) {
        try {
          const result = JSON.parse(response.result);
          if (result.success) {
            // 格式化输出
            const lines = [`✅ 技能执行成功：${skillName}`];
            if (result.message) {
              lines.push(`   ${result.message}`);
            }
            if (result.data) {
              lines.push('', JSON.stringify(result.data, null, 2));
            }
            return lines.join('\n');
          }
          return `❌ 技能执行失败：${result.error || result.message}`;
        } catch (parseError) {
          return `❌ 响应解析失败：${parseError instanceof Error ? parseError.message : parseError}`;
        }
      }
      return `❌ 请求失败：${response.error}`;
    }

    default:
      return `❌ 未知命令：${command}\n输入 'help' 查看可用命令`;
  }
}

/**
 * 启动 REPL
 */
export async function startRepl(): Promise<void> {
  // 检查 daemon 状态
  if (!isDaemonRunning()) {
    console.log('⚠️  Daemon 未运行，建议先启动：js-reverse start');
    console.log('   按 Ctrl+C 退出');
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'js-reverse> ',
    historySize: 100,
  });

  console.log('🚀 JS Reverse MCP - REPL 交互模式');
  console.log('   输入 "help" 查看可用命令，输入 "exit" 退出');
  console.log('');

  rl.prompt();

  rl.on('line', async (line: string) => {
    // Input length check
    if (line.length > MAX_INPUT_LENGTH) {
      console.error(`❌ 输入过长，最大长度为 ${MAX_INPUT_LENGTH}`);
      rl.prompt();
      return;
    }

    const trimmedLine = line.trim();

    // 处理清屏命令
    if (trimmedLine.toLowerCase() === 'clear') {
      console.clear();
      rl.prompt();
      return;
    }

    // 跳过空行
    if (!trimmedLine) {
      rl.prompt();
      return;
    }

    try {
      const result = await executeCommand(trimmedLine);

      if (result === '__EXIT__') {
        console.log('👋 再见！');
        rl.close();
        return;
      }

      if (result) {
        console.log(result);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ 错误：${errorMessage}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n👋 再见！');
    process.exit(0);
  });

  rl.on('SIGINT', () => {
    console.log('\n👋 再见！');
    process.exit(0);
  });
}
