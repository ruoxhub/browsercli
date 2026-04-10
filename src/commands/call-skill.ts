#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {sendCommand} from '../daemon/client.js';

export async function callSkillCommand(
  name: string,
  options: {url?: string; data?: string},
): Promise<void> {
  try {
    const args: Record<string, unknown> = {};
    if (options.url) {
      args.url = options.url;
    }
    if (options.data) {
      try {
        args.data = JSON.parse(options.data);
      } catch {
        console.error(
          `错误：--data 参数必须是有效的 JSON 格式，收到：${options.data}`,
        );
        process.exit(1);
      }
    }

    const result = await sendCommand({
      method: 'invoke_skill',
      skill: name,
      args,
    });

    if (result.success) {
      console.log(result.result || '技能执行成功');
    } else {
      console.error(`技能执行失败：${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `技能调用失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
