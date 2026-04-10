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
import {logger} from '../logger.js';

const REPL_COMMANDS = ['status', 'list-skills', 'list-tools', 'help', 'exit', 'quit'];
const SKILL_NAMES = getBuiltInSkillDefinitions().map(s => s.name);
let TOOL_NAMES: string[] | null = null;

function getToolNames(): string[] {
  if (TOOL_NAMES) return TOOL_NAMES;
  TOOL_NAMES = listTools().map(t => t.name);
  return TOOL_NAMES;
}

function complete(input: string): string[] {
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
  logger('可用命令：');
  logger('  skill <name> [args...]  - 调用指定技能');
  logger('  tool <name> [args...]   - 调用指定工具');
  logger('  status                  - 查看 daemon 状态');
  logger('  list-skills             - 列出可用技能');
  logger('  list-tools              - 列出可用工具');
  logger('  help                    - 显示此帮助信息');
  logger('  exit / quit             - 退出 REPL');
  logger('');
}

export async function replCommand(): Promise<void> {
  // 启动前检查 daemon 状态
  try {
    const statusResult = await sendCommand({method: 'status'});
    if (statusResult.success) {
      const info = JSON.parse(statusResult.result);
      logger(`Daemon 已连接 (PID: ${info.pid})`);
    }
  } catch {
    logger('⚠ 后台服务未运行，请先执行：js-reverse start --browserUrl <url>');
    logger('');
  }

  logger('进入交互模式 (REPL)');
  printHelp();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    tabSize: 2,
    completer: complete,
  });

  rl.on('SIGINT', () => {
    logger('');
    prompt();
  });

  const prompt = () => {
    rl.question('js-reverse> ', async input => {
      const trimmed = input.trim();

      if (trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        return;
      }

      if (trimmed === 'help') {
        printHelp();
        prompt();
        return;
      }

      if (trimmed === 'status') {
        try {
          const result = await sendCommand({method: 'status'});
          if (result.success) {
            logger(`状态：${result.result}`);
          } else {
            logger(`未运行：${result.error}`);
          }
        } catch (error) {
          logger(
            `获取状态失败：${error instanceof Error ? error.message : error}`,
          );
        }
        prompt();
        return;
      }

      if (trimmed === 'list-skills') {
        try {
          const result = await sendCommand({method: 'list_skills'});
          if (result.success) {
            logger(result.result || '');
          } else {
            logger(`获取失败：${result.error}`);
          }
        } catch (error) {
          logger(
            `获取技能列表失败：${error instanceof Error ? error.message : error}`,
          );
        }
        prompt();
        return;
      }

      if (trimmed === 'list-tools') {
        try {
          const result = await sendCommand({method: 'list_tools'});
          if (result.success) {
            logger(result.result || '');
          } else {
            logger(`获取失败：${result.error}`);
          }
        } catch (error) {
          logger(
            `获取工具列表失败：${error instanceof Error ? error.message : error}`,
          );
        }
        prompt();
        return;
      }

      if (!trimmed) {
        prompt();
        return;
      }

      const parts = trimmed.split(/\s+/);
      const [type, name, ...args] = parts;

      if (!type || !name) {
        logger('用法：skill <name> [args...] 或 tool <name> [args...]');
        logger('输入 "help" 查看完整帮助');
        prompt();
        return;
      }

      try {
        if (type === 'skill') {
          const result = await sendCommand({
            method: 'invoke_skill',
            skill: name,
            args: {args},
          });
          logger(
            result.success ? result.result || '成功' : `失败：${result.error}`,
          );
        } else if (type === 'tool') {
          const result = await sendCommand({
            method: 'invoke_tool',
            tool: name,
            args: {args},
          });
          logger(
            result.success ? result.result || '成功' : `失败：${result.error}`,
          );
        } else {
          logger('未知命令类型，使用 "skill" 或 "tool"');
          logger('输入 "help" 查看完整帮助');
        }
      } catch (error) {
        logger(`执行失败：${error instanceof Error ? error.message : error}`);
      }

      prompt();
    });
  };

  prompt();
}
