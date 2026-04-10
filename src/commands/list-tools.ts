#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {listTools} from '../tools/index.js';
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
  let tools: Array<{name: string; description?: string}> = [];
  let isOffline = false;

  // Try daemon first
  try {
    const result = await sendCommand({method: 'list_tools'});
    if (result.success && result.result) {
      const data = JSON.parse(result.result);
      tools = data.tools || [];
    }
  } catch {
    // Daemon not running, fall back to built-in tools
    isOffline = true;
  }

  // Fallback to built-in tools
  if (tools.length === 0) {
    isOffline = true;
    const builtInTools = listTools();
    tools = builtInTools.map(t => ({
      name: t.name,
      description: t.description,
    }));
  }

  console.log(formatTools(tools, !!options.json));

  if (isOffline && !options.json) {
    console.log('\n(离线模式：显示内置工具定义，启动后台服务可获取完整工具列表)');
  }
}
