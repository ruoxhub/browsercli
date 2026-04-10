#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {sendCommand} from '../daemon/client.js';

/** Format tools for display */
export function formatTools(
  tools: Array<{name: string; description?: string}>,
  json: boolean,
): string {
  if (json) return JSON.stringify(tools, null, 2);
  if (tools.length === 0) return '可用工具:\n  (无)';
  return '可用工具:\n' + tools.map(t => `  - ${t.name}`).join('\n');
}

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

    console.log(formatTools(tools, !!options.json));
  } catch (error) {
    console.error(
      `获取工具列表失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
