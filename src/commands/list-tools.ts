#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {sendCommand} from '../daemon/client.js';

export async function listToolsCommand(options: {
  json?: boolean;
}): Promise<void> {
  try {
    const result = await sendCommand({method: 'list_tools'});
    if (!result.success || !result.result) {
      console.error('获取工具列表失败');
      process.exit(1);
    }

    const data = JSON.parse(result.result);
    const tools = data.tools || [];

    if (options.json) {
      console.log(JSON.stringify(tools, null, 2));
    } else {
      console.log('可用工具:');
      for (const tool of tools) {
        console.log(`  - ${tool.name}`);
      }
    }
  } catch (error) {
    console.error(
      `获取工具列表失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
