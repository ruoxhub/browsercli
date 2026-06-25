/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as ToolsMeta from '../cli/tools-meta.js';
import type {ActionHandler} from '../types/rpc.js';

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
      const {ensureToolsMeta, getAllToolNames, getToolMeta} = toolsMetaCache;
      await ensureToolsMeta();
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
    const mem = process.memoryUsage();
    const clientStatus = client.getStatus() as Record<string, unknown> | null;
    const isConnected = Boolean(
      clientStatus &&
      typeof clientStatus === 'object' &&
      (clientStatus as {isConnected?: boolean}).isConnected,
    );

    resolve({
      pid: process.pid,
      status: clientStatus,
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
      },
      nodeVersion: process.version,
      health: isConnected ? 'healthy' : 'degraded',
    });
  });
}
