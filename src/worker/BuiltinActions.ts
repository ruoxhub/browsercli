/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as ToolsMeta from '../cli/tools-meta.js';
import type {ActionHandler} from '../types/sekiro.js';

interface BuiltinActionClient {
  getStatus(): unknown;
  registerAction(name: string, handler: ActionHandler): void;
}

type ToolsMetaModule = typeof ToolsMeta;

/**
 * 注册 Worker 自带的 Sekiro Actions。
 */
export function registerBuiltinActions(client: BuiltinActionClient): void {
  let toolsMetaCache: ToolsMetaModule | undefined;

  client.registerAction('_list_tools', async (_request, resolve, reject) => {
    try {
      if (!toolsMetaCache) {
        toolsMetaCache = await import('../cli/tools-meta.js');
      }
      const {getAllToolNames, getToolMeta} = toolsMetaCache;
      const tools = getAllToolNames().map(name => {
        const meta = getToolMeta(name);
        return {name, description: meta?.description || ''};
      });
      resolve({tools});
    } catch (err) {
      reject(err instanceof Error ? err.message : String(err));
    }
  });

  client.registerAction('_status', (_request, resolve, _reject) => {
    resolve({
      pid: process.pid,
      status: client.getStatus(),
      uptime: process.uptime(),
    });
  });
}
