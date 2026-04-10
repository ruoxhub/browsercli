#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import * as readline from 'node:readline';

import {sendCommand} from '../daemon/client.js';
import {listTools} from '../tools/index.js';
import {getBuiltInSkillDefinitions} from '../skills/index.js';

/** REPL 专用 replLog，始终输出到 stderr（避免与 stdout 管道混用） */
function replLog(msg: string): void {
  process.stderr.write(msg + '\n');
}

const REPL_COMMANDS = [
  'status',
  'list-skills',
  'list-tools',
  'help',
  'exit',
  'quit',
];
const SKILL_NAMES = getBuiltInSkillDefinitions().map(s => s.name);
let TOOL_NAMES: string[] | null = null;

function getToolNames(): string[] {
  if (TOOL_NAMES) return TOOL_NAMES;
  TOOL_NAMES = listTools().map(t => t.name);
  return TOOL_NAMES;
}

export function complete(input: string): string[] {
  const parts = input.split(/\s+/);
  const isLastCharSpace = input.endsWith(' ') && input.length > 0;

  if (parts.length <= 1 && !isLastCharSpace) {
    // Completing first word: commands
    const partial = parts[0].toLowerCase();
    return REPL_COMMANDS.filter(cmd => cmd.startsWith(partial));
  }

  if (parts.length === 2 && !isLastCharSpace) {
    const cmd = parts[0].toLowerCase();
    const partial = parts[1].toLowerCase();
    if (cmd === 'skill') {
      return SKILL_NAMES.filter(s => s.startsWith(partial));
    }
    if (cmd === 'tool') {
      return getToolNames().filter(t => t.startsWith(partial));
    }
  }

  return [];
}

function printHelp(): void {
  replLog('可用命令：');
  replLog('  skill <name> [args...]  - 调用指定技能');
  replLog('  tool <name> [args...]   - 调用指定工具');
  replLog('  status                  - 查看 daemon 状态');
  replLog('  list-skills             - 列出可用技能');
  replLog('  list-tools              - 列出可用工具');
  replLog('  help                    - 显示此帮助信息');
  replLog('  exit / quit             - 退出 REPL');
  replLog('');
}

export async function replCommand(): Promise<void> {
  // 启动前检查 daemon 状态
  try {
    const statusResult = await sendCommand({method: 'status'});
    if (statusResult.success) {
      const info = JSON.parse(statusResult.result);
      replLog(`Daemon 已连接 (PID: ${info.pid})`);
    }
  } catch {
    replLog('⚠ 后台服务未运行，请先执行：js-reverse start --browserUrl <url>');
    replLog('');
  }

  replLog('进入交互模式 (REPL)');
  printHelp();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    tabSize: 2,
    completer: process.stdin.isTTY ? complete : undefined,
    terminal: false,
  });

  rl.on('SIGINT', () => {
    replLog('');
    if (process.stdin.isTTY) prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });

  const processLine = async (line: string) => {
    const trimmed = line.trim();

    if (trimmed === 'exit' || trimmed === 'quit') {
      rl.close();
      return;
    }

    if (trimmed === 'help') {
      printHelp();
      return;
    }

    if (trimmed === 'status') {
      try {
        const result = await sendCommand({method: 'status'});
        if (result.success) {
          replLog(`状态：${result.result}`);
        } else {
          replLog(`未运行：${result.error}`);
        }
      } catch (error) {
        replLog(
          `获取状态失败：${error instanceof Error ? error.message : error}`,
        );
      }
      return;
    }

    if (trimmed === 'list-skills') {
      try {
        const result = await sendCommand({method: 'list_skills'});
        if (result.success) {
          replLog(result.result || '');
        } else {
          replLog(`获取失败：${result.error}`);
        }
      } catch {
        const skills = getBuiltInSkillDefinitions();
        replLog(`可用技能 (${skills.length}):`);
        for (const s of skills) {
          replLog(`  - ${s.name}: ${s.description}`);
        }
        replLog('');
        replLog('(离线模式：显示内置技能列表)');
      }
      return;
    }

    if (trimmed === 'list-tools') {
      try {
        const result = await sendCommand({method: 'list_tools'});
        if (result.success) {
          replLog(result.result || '');
        } else {
          replLog(`获取失败：${result.error}`);
        }
      } catch {
        const tools = listTools();
        replLog(`可用工具 (${tools.length}):`);
        for (const t of tools) {
          replLog(`  - ${t.name}`);
        }
        replLog('');
        replLog('(离线模式：显示内置工具列表)');
      }
      return;
    }

    if (!trimmed) {
      return;
    }

    const parts = trimmed.split(/\s+/);
    const [type, name, ...args] = parts;

    if (!type || !name) {
      replLog('用法：skill <name> [args...] 或 tool <name> [args...]');
      replLog('输入 "help" 查看完整帮助');
      return;
    }

    try {
      if (type === 'skill') {
        const result = await sendCommand({
          method: 'invoke_skill',
          skill: name,
          args: {args},
        });
        replLog(
          result.success ? result.result || '成功' : `失败：${result.error}`,
        );
      } else if (type === 'tool') {
        const result = await sendCommand({
          method: 'invoke_tool',
          tool: name,
          args: {args},
        });
        replLog(
          result.success ? result.result || '成功' : `失败：${result.error}`,
        );
      } else {
        replLog('未知命令类型，使用 "skill" 或 "tool"');
        replLog('输入 "help" 查看完整帮助');
      }
    } catch (error) {
      replLog(`执行失败：${error instanceof Error ? error.message : error}`);
    }
  };

  // TTY 模式：使用 question() 循环（带 prompt）
  const prompt = () => {
    rl.question('js-reverse> ', async input => {
      await processLine(input);
      prompt();
    });
  };

  // 非 TTY 模式（管道/重定向）：逐行处理
  if (!process.stdin.isTTY) {
    rl.on('line', async line => {
      await processLine(line);
    });
  } else {
    prompt();
  }
}
