#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import * as readline from 'node:readline';

import {sendCommand} from '../daemon/client.js';
import {logger} from '../logger.js';

export async function replCommand(options: {
  browserUrl?: string;
}): Promise<void> {
  logger('进入交互模式 (REPL)');
  logger('输入命令格式：skill <name> [args...] 或 tool <name> [args...]');
  logger('输入 "exit" 或按 Ctrl+C 退出');
  logger('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('js-reverse> ', async input => {
      const trimmed = input.trim();

      if (trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
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
        }
      } catch (error) {
        logger(`执行失败：${error instanceof Error ? error.message : error}`);
      }

      prompt();
    });
  };

  prompt();
}
