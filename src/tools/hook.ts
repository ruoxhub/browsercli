/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import type {getJSHookRuntime} from './runtime.js';
import {defineTool} from './ToolDefinition.js';

export interface NormalizedHookRecord {
  target: string;
  event: string;
  method: string;
  url: string;
  status?: number;
  bodySnippet: string;
  timestamp?: number;
}

export function normalizeHookRecord(
  record: Record<string, unknown>,
): NormalizedHookRecord {
  const body =
    typeof record.body === 'string'
      ? record.body
      : typeof record.requestBody === 'string'
        ? record.requestBody
        : typeof record.data === 'string'
          ? record.data
          : '';
  return {
    target: typeof record.target === 'string' ? record.target : 'unknown',
    event: typeof record.event === 'string' ? record.event : '',
    method:
      typeof record.method === 'string' ? record.method.toUpperCase() : '',
    url: typeof record.url === 'string' ? record.url : '',
    status: typeof record.status === 'number' ? record.status : undefined,
    bodySnippet: body.slice(0, 200),
    timestamp:
      typeof record.timestamp === 'number' ? record.timestamp : undefined,
  };
}

function normalizeRecordForDedupe(record: NormalizedHookRecord): {
  key: string;
  summary: NormalizedHookRecord;
} {
  const key = [
    record.target,
    record.event,
    record.method,
    record.url,
    record.bodySnippet.slice(0, 256),
  ].join('::');
  return {key, summary: record};
}

export function summarizeHookRecords(
  records: NormalizedHookRecord[],
  maxRecords: number,
): {
  total: number;
  unique: number;
  dropped: number;
  records: Array<Record<string, unknown>>;
} {
  const byKey = new Map<
    string,
    {count: number; sample: NormalizedHookRecord}
  >();
  for (const record of records) {
    const normalized = normalizeRecordForDedupe(record);
    const existing = byKey.get(normalized.key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(normalized.key, {count: 1, sample: normalized.summary});
  }

  const deduped = Array.from(byKey.values()).map(item => ({
    ...(item.sample as unknown as Record<string, unknown>),
    count: item.count,
  }));
  deduped.sort((a, b) => Number(b.count) - Number(a.count));
  const limited = deduped.slice(0, maxRecords);
  return {
    total: records.length,
    unique: deduped.length,
    dropped: deduped.length - limited.length,
    records: limited,
  };
}

export function inferCandidateEnvNeeds(
  records: NormalizedHookRecord[],
): string[] {
  const needs = new Set<string>();
  for (const record of records) {
    if (record.url.startsWith('http://') || record.url.startsWith('https://')) {
      needs.add('location');
      needs.add('fetch');
    }
    if (
      record.bodySnippet.includes('token') ||
      record.bodySnippet.includes('cookie')
    ) {
      needs.add('cookie');
      needs.add('storage');
    }
    if (
      record.bodySnippet.includes('nonce') ||
      record.bodySnippet.includes('timestamp')
    ) {
      needs.add('Date');
    }
  }
  return Array.from(needs).sort();
}

export function buildRequestBindings(
  records: NormalizedHookRecord[],
): Array<Record<string, unknown>> {
  return records
    .filter(record => record.url)
    .slice(0, 10)
    .map(record => ({
      target: record.target,
      event: record.event,
      method: record.method || 'UNKNOWN',
      url: record.url,
      status: record.status,
    }));
}

export function toHookRecordArray(
  data: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === 'object',
  );
}

async function syncHookRecordsFromPage(
  runtime: ReturnType<typeof getJSHookRuntime>,
  hookId?: string,
): Promise<void> {
  interface EvaluatingPage {
    evaluate: (fn: (id?: string) => unknown, id?: string) => Promise<unknown>;
  }

  let page: EvaluatingPage | null = null;
  try {
    page =
      (await runtime.collector.getActivePage()) as unknown as EvaluatingPage;
  } catch {
    return;
  }

  if (!page || typeof page.evaluate !== 'function') {
    return;
  }

  const storeSnapshot = await page.evaluate((id?: string) => {
    const rawStore = (window as typeof window & {__hookStore?: unknown})
      .__hookStore;
    const store =
      rawStore && typeof rawStore === 'object'
        ? (rawStore as Record<string, unknown>)
        : {};

    const normalize = (value: unknown) => (Array.isArray(value) ? value : []);

    if (typeof id === 'string' && id.length > 0) {
      return {[id]: normalize(store[id])};
    }

    const all: Record<string, unknown[]> = {};
    for (const [key, value] of Object.entries(store)) {
      if (Array.isArray(value)) {
        all[key] = value;
      }
    }
    return all;
  }, hookId);

  if (!storeSnapshot || typeof storeSnapshot !== 'object') {
    return;
  }

  for (const [id, records] of Object.entries(
    storeSnapshot as Record<string, unknown>,
  )) {
    runtime.hookManager.clearRecords(id);
    for (const record of toHookRecordArray(records)) {
      runtime.hookManager.addRecord(id, {
        hookId: id,
        timestamp:
          typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
        ...record,
      });
    }
  }
}

/**
 * Create a hook script for function/fetch/xhr/property/cookie/websocket/eval/timer.
 * Hooks run without pausing page execution and are the preferred approach over breakpoints for monitoring and interception.
 *
 * Example:
 * - Monitor fetch: `{type: "fetch", action: "log"}`
 * - Hook function: `{type: "function", target: "JSON.stringify", action: "log"}`
 * - Monitor XHR: `{type: "xhr", action: "log"}`
 */
export const createHook = defineTool({
  name: 'create_hook',
  description:
    'RECOMMENDED: Create hook script for function/fetch/xhr/property/cookie/websocket/eval/timer. Hooks run without pausing page execution and are the preferred approach over breakpoints for monitoring and interception.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
    title: 'Create hook',
  },
  schema: {
    type: zod
      .string()
      .describe(
        'Hook type: function, fetch, xhr, property, cookie, websocket, eval, timer',
      ),
    params: zod
      .record(zod.string(), zod.unknown())
      .optional()
      .describe('Hook parameters (e.g., target function name)'),
    description: zod
      .string()
      .optional()
      .describe('Optional description for the hook'),
    action: zod
      .enum(['log', 'block', 'modify', 'passthrough'])
      .optional()
      .describe('Hook action: log (default), block, modify, or passthrough'),
  },
  handler: async (request, response, context, runtime) => {
    void context;
    const {type} = request.params as {
      type: string;
      params?: Record<string, unknown>;
      description?: string;
      action?: 'log' | 'block' | 'modify' | 'passthrough';
    };
    const result = runtime.hookManager.create({type, ...request.params});
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

/**
 * Inject an existing hook into the current page.
 * The hook script will be executed and start monitoring/intercepting immediately.
 */
export const injectHook = defineTool({
  name: 'inject_hook',
  description: 'Inject an existing hook into the current page.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
    title: 'Inject hook',
  },
  schema: {
    hookId: zod
      .string()
      .describe('The hook ID to inject (from create_hook response)'),
  },
  handler: async (request, response, context, runtime) => {
    void context;
    const hook = runtime.hookManager.getHook(request.params.hookId);
    if (!hook) {
      response.appendResponseLine(
        `Hook 未找到：${request.params.hookId}，请先使用 create_hook 创建`,
      );
      return;
    }
    await runtime.pageController.injectScript(hook.script);
    response.appendResponseLine(`Hook injected: ${hook.hookId}`);
  },
});

/**
 * Get captured data for one hook or all hooks.
 * Supports raw view and summary view for noise reduction.
 * Summary view deduplicates records by target/event/method/url/body and shows counts.
 */
export const getHookData = defineTool({
  name: 'get_hook_data',
  description:
    'Get captured data for one hook or all hooks. Supports raw view and summary view for noise reduction.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
    title: 'Get hook captured data',
  },
  schema: {
    hookId: zod
      .string()
      .optional()
      .describe('Optional hook ID. If omitted, returns data for all hooks.'),
    view: zod
      .enum(['raw', 'summary'])
      .optional()
      .describe(
        'View mode: raw (all records) or summary (deduplicated with counts). Default: raw',
      ),
    maxRecords: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum records to return in summary mode. Default: 100'),
  },
  handler: async (request, response, context, runtime) => {
    void context;
    await syncHookRecordsFromPage(runtime, request.params.hookId);
    const view = request.params.view ?? 'raw';
    const maxRecords = request.params.maxRecords ?? 100;
    let data: unknown;
    if (request.params.hookId) {
      const records = (
        runtime.hookManager.getRecords(request.params.hookId) as Array<
          Record<string, unknown>
        >
      ).map(normalizeHookRecord);
      data =
        view === 'summary'
          ? {
              ...summarizeHookRecords(records, maxRecords),
              candidateEnvNeeds: inferCandidateEnvNeeds(records),
              requestBindings: buildRequestBindings(records),
            }
          : records;
    } else if (view === 'summary') {
      const hookIds = runtime.hookManager.getAllKnownHookIds();
      data = hookIds.map(hookId => {
        const records = (
          runtime.hookManager.getRecords(hookId) as Array<
            Record<string, unknown>
          >
        ).map(normalizeHookRecord);
        const meta = runtime.hookManager.getHook(hookId);
        return {
          hookId,
          type: meta?.type ?? 'unknown',
          ...summarizeHookRecords(records, maxRecords),
          candidateEnvNeeds: inferCandidateEnvNeeds(records),
          requestBindings: buildRequestBindings(records),
        };
      });
    } else {
      data = runtime.hookManager.exportData('json');
    }
    response.appendResponseLine('```json');
    response.appendResponseLine(
      typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    );
    response.appendResponseLine('```');
  },
});

/**
 * List all hooks created via create_hook with their status and record counts.
 */
export const listCreatedHooks = defineTool({
  name: 'list_created_hooks',
  description:
    'List all hooks created via create_hook with their status and record counts.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
    title: 'List created hooks',
  },
  schema: {
    verbose: zod
      .boolean()
      .optional()
      .describe('Show detailed info including record counts. Default: false'),
  },
  handler: async (request, response, context, runtime) => {
    void context;
    const hookIds = runtime.hookManager.getAllKnownHookIds();
    if (hookIds.length === 0) {
      response.appendResponseLine('当前没有已创建的 hook');
      response.appendResponseLine(
        '使用 create_hook 创建 hook，例如：{type: "fetch", action: "log"}',
      );
      return;
    }

    if (request.params.verbose) {
      const details = hookIds.map(id => {
        const meta = runtime.hookManager.getHook(id);
        const records = runtime.hookManager.getRecords(id);
        return {
          hookId: id,
          type: meta?.type ?? 'unknown',
          enabled: meta?.enabled ?? false,
          recordCount: records.length,
        };
      });
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(details, null, 2));
      response.appendResponseLine('```');
    } else {
      response.appendResponseLine(`已创建的 hook (${hookIds.length} 个):`);
      for (const id of hookIds) {
        const meta = runtime.hookManager.getHook(id);
        const records = runtime.hookManager.getRecords(id);
        const type = meta?.type ?? 'unknown';
        response.appendResponseLine(
          `  - [${id}] type: ${type}, records: ${records.length}`,
        );
      }
    }
  },
});

/**
 * Remove a hook by ID.
 * This stops the hook from capturing any more data and removes it from memory.
 */
export const removeHook = defineTool({
  name: 'remove_hook',
  description: 'Remove a hook by id.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
    title: 'Remove hook',
  },
  schema: {hookId: zod.string().describe('The hook ID to remove')},
  handler: async (request, response, context, runtime) => {
    void context;
    const removed = runtime.hookManager.remove(request.params.hookId);
    if (!removed) {
      response.appendResponseLine(`Hook 未找到：${request.params.hookId}`);
      return;
    }
    // 清理浏览器端数据（不恢复被 monkey-patch 的原生方法，因为那可能导致页面状态不一致）
    try {
      const page = (await runtime.collector.getActivePage()) as unknown as {
        evaluate: (fn: string) => Promise<void>;
      };
      await page.evaluate(
        `(function(){ const s=window.__hookStore; if(s&&s['${request.params.hookId}']){ delete s['${request.params.hookId}']; } })()`,
      );
    } catch {
      // 页面已关闭或无法访问，忽略
    }
    response.appendResponseLine(
      `Hook removed: ${request.params.hookId}（MCP 端数据已清理，浏览器端数据已标记清除）`,
    );
  },
});
