#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {sendCommand} from '../daemon/client.js';

export async function callToolCommand(
  name: string,
  options: {url?: string; param?: string[]},
): Promise<void> {
  try {
    const args: Record<string, unknown> = {};
    if (options.url) {
      args.url = options.url;
    }

    // 解析 --param key=value 格式
    if (options.param && options.param.length > 0) {
      for (const param of options.param) {
        const [key, ...valueParts] = param.split('=');
        args[key] = valueParts.join('=');
      }
    }

    const result = await sendCommand({
      method: 'invoke_tool',
      tool: name,
      args,
    });

    if (result.success) {
      console.log(result.result || '工具执行成功');
    } else {
      console.error(`工具执行失败：${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `工具调用失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
