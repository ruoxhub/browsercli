/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildRequestBindings,
  filterHookStore,
  HOOK_STORE_KEY,
  inferCandidateEnvNeeds,
  normalizeHookRecord,
  readHookStore,
  readMcpHookRegistry,
  summarizeHookRecords,
  summarizeHookStore,
  toHookRecordArray,
} from '../modules/hook/HookRecordAnalyzer.js';
import type {RegisterPersistentHookResult} from '../modules/hook/index.js';
import {type Frame, zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import {evaluateInPageRuntime} from './debugger.js';
import type {DomainManifest} from './manifest.js';
import {getErrorMessage} from './shared/pageResponse.js';
import type {MessagesResult} from './shared/types.js';
import {
  type Context,
  defineBrowserTool,
  definePageTool,
} from './ToolDefinition.js';

// ─── types.ts ────────────────────────────────────────────

// ─── Hook 安装函数返回类型 ─────────────────────────────

/**
 * Hook 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface HookResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 日志输出格式 */
export type LogFormat = 'full' | 'compact' | 'json';

/** Storage 操作类型 */
export type StorageAction = 'setItem' | 'getItem' | 'removeItem' | 'clear';

/** Console 保护模式 */
export type ConsoleProtectMode = 'proxy' | 'toString' | 'freeze';

/** Bypass Debugger 目标 */
export type BypassTarget = 'eval' | 'Function' | 'constructor';

// ─── Hook 管理函数返回类型 ─────────────────────────────

/**
 * Hook 管理操作统一返回结构（与 HookResult 相同）。
 */
export type HookManagementResult<T = unknown> = HookResult<T>;

/** 注入 Hook 返回数据 */
export interface InjectHookData {
  hookId: string;
  persisted: boolean;
  ranOnCurrentFrame: boolean;
  world: 'main' | 'isolated';
  requestedWorld: 'main' | 'isolated';
  effectiveWorld: 'main';
  persistentStrategy: 'addInitScript' | 'evaluate-once';
  applyMode?: 'existing-and-future';
  registered?: boolean;
  idempotent?: boolean;
  appliedFrames?: number;
  failedFrames?: RegisterPersistentHookResult['failedFrames'];
  partial?: boolean;
  warnings?: string[];
}

/** 注入 Hook 结果 */
export interface InjectHookResult extends HookManagementResult<InjectHookData> {
  tooltype: 'inject_hook';
}

/** 获取 Hook 数据结果 */
export interface GetHookDataResult extends HookManagementResult<unknown> {
  tooltype: 'get_hook_data';
}

export type {Frame};

export * from '../modules/hook/HookRecordAnalyzer.js';

// ─── CreateHook.ts ───────────────────────────────────────

/**
 * 创建 Hook 定义：在进程内生成 hook 脚本和元数据，不注入浏览器。
 *
 * 返回 hookId 和 script，后续通过 inject_hook 注入页面。
 * 参考 old-source/src/tools/hook.ts 的 createHook。
 */
export const createHook = definePageTool({
  name: 'create_hook',
  requirePage: false,
  description:
    '推荐：为 function/fetch/xhr/websocket/property/event/timer/localstorage/cookie/eval/object-method/custom 创建 hook 脚本。Hook 运行时不会暂停页面执行，相比断点是更优的监控与拦截手段。默认仅生成并返回 hookId 与 script 供 inject_hook 使用；设置 inject=true 时可一步注入当前 BrowserPage（可搭配 persistent=true 注册为 PersistentHook）。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    type: zod
      .string()
      .describe(
        'Hook 类型（内置支持："function"、"fetch"、"xhr"、"websocket"、"property"、"event"、"timer"、"localstorage"、"cookie"、"eval"、"object-method"、"custom"）',
      ),
    params: zod
      .unknown()
      .optional()
      .describe('类型相关参数（对象、数组或任意值）'),
    description: zod.string().optional().describe('该 Hook 的可读描述'),
    action: zod
      .enum(['log', 'block', 'modify', 'passthrough'])
      .optional()
      .describe('Hook 动作模式（默认：log）'),
    hookId: zod.string().optional().describe('自定义 Hook 标识符'),
    capture: zod
      .object({
        args: zod.boolean().optional(),
        returnValue: zod.boolean().optional(),
        stack: zod.union([zod.boolean(), zod.number()]).optional(),
        timing: zod.boolean().optional(),
        thisContext: zod.boolean().optional(),
      })
      .optional()
      .describe('采集配置'),
    condition: zod
      .object({
        expression: zod.string().optional(),
        maxCalls: zod.number().int().positive().optional(),
        minInterval: zod.number().int().positive().optional(),
        urlPattern: zod.string().optional(),
      })
      .optional()
      .describe('条件执行'),
    protocolFallback: zod
      .boolean()
      .optional()
      .describe(
        'opt-in 协议级拦截：为 true 时由注入方启用 CDP Fetch.enable 回退（默认 false）。',
      ),
    inject: zod
      .boolean()
      .optional()
      .default(false)
      .describe(
        '创建后是否立即作为 PageHook 注入当前选中 Frame（默认 false；传 true 时一步完成创建与注入）。',
      ),
    persistent: zod
      .boolean()
      .optional()
      .default(false)
      .describe(
        '当 inject=true 时，是否注册为 BrowserContext 级 PersistentHook（默认 false）。',
      ),
  },
  handler: async (request, response, context) => {
    const hookManager = context.getHookManager?.();
    if (!hookManager) {
      throw createToolError(ErrorCodes.RUNTIME, 'HookManager 服务不可用', {
        toolName: 'create_hook',
      });
    }
    try {
      const {inject = false, persistent = false} = request.params;
      // 归一化 params：对象直接透传；数组/字符串等其他值包裹为 {value}。
      const rawParams = (request.params as Record<string, unknown>).params;
      let normalizedParams: Record<string, unknown> | undefined;
      if (rawParams !== undefined && rawParams !== null) {
        normalizedParams =
          typeof rawParams === 'object' && !Array.isArray(rawParams)
            ? (rawParams as Record<string, unknown>)
            : {value: rawParams};
      }

      const result = hookManager.create({
        ...(request.params as Record<string, unknown>),
        params: normalizedParams,
      } as any);

      let injected = false;
      let persisted = false;
      if (inject) {
        if (!persistent) {
          await evaluateInPageRuntime(
            context.getSelectedFrame(),
            result.script,
          );
          injected = true;
        } else {
          const browserContext = context.getBrowserContext();
          if (!browserContext || browserContext.isClosed()) {
            throw createToolError(
              ErrorCodes.BROWSER_REQUIRED,
              '当前 BrowserContext 不可用或已关闭，无法注册持久 Hook',
              {toolName: 'create_hook'},
            );
          }
          await context.getPersistentHookRegistry().register({
            context: browserContext,
            hookId: result.hookId,
            script: result.script,
            source: 'create_hook',
            requestedWorld: 'main',
            applyMode: 'existing-and-future',
          });
          injected = true;
          persisted = true;
        }
      }

      response.setStructuredContent({
        success: true,
        message: injected
          ? `Hook created and injected: ${result.hookId}${persisted ? ' (persistent)' : ''}`
          : result.hookId
            ? `Hook created: ${result.hookId}`
            : 'Hook created',
        tooltype: 'create_hook',
        data: {
          ...result,
          ...(inject ? {injected, persisted} : {}),
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(ErrorCodes.RUNTIME, getErrorMessage(error), {
        toolName: 'create_hook',
      });
    }
  },
});

// ─── GetHookData.ts ──────────────────────────────────────

interface HookDiagnostic {
  hookId: string;
  type: string;
  issue: 'hook_installed_no_records';
  likelyCauses: string[];
  nextSteps: string[];
}

/**
 * 从浏览器端获取 Hook 采集的数据，先同步到 HookManager 再读取。
 *
 * 参考 old-source/src/tools/hook.ts 的 getHookData。
 */
export const getHookData = definePageTool({
  name: 'get_hook_data',
  requirePage: false,
  description:
    '获取 Hook 采集到的数据。会先从浏览器同步到 HookManager，再返回数据。支持 raw、summary、detail 三种视图并支持过滤。',
  annotations: {
    title: 'Get Hook Data',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    hookId: zod
      .string()
      .optional()
      .describe('指定 Hook ID，省略则返回全部 Hook'),
    view: zod
      .enum(['raw', 'summary', 'detail'])
      .optional()
      .describe(
        '视图模式：raw（原始）、summary（去重摘要）、detail（含诊断信息），默认 raw',
      ),
    maxRecords: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的最大记录条数'),
    type: zod.string().optional().describe('按 Hook 类型过滤'),
    event: zod.string().optional().describe('按事件名过滤'),
    phase: zod.string().optional().describe('按阶段过滤'),
  },
  handler: async (request, response, context) => {
    const {hookId, view, maxRecords, type, event, phase} = request.params;
    const hookManager = context.getHookManager?.();
    const pageHookStore = context.getPageHookStore?.();

    if (view && !['raw', 'summary', 'detail'].includes(view)) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        `view 参数无效: "${view}"，支持: raw, summary, detail`,
        {toolName: 'get_hook_data', view},
      );
    }

    try {
      let storeSnapshot: Record<string, unknown[]> = {};
      try {
        const frame = (context as Context).getSelectedFrame();
        const browserData = await readHookStore(frame, hookId);

        // 同步到单页 PageHookStore 与 HookManager
        for (const [id, records] of Object.entries(browserData)) {
          pageHookStore?.clear(id);
          hookManager?.clearRecords(id);
          for (const record of toHookRecordArray(records)) {
            const normalizedRecord = {
              hookId: id,
              timestamp:
                typeof record.timestamp === 'number'
                  ? record.timestamp
                  : Date.now(),
              ...record,
            };
            pageHookStore?.add(id, normalizedRecord);
            hookManager?.addRecord(id, normalizedRecord);
          }
        }
        storeSnapshot = browserData;
      } catch {
        // 浏览器不可用，优先从单页 PageHookStore、再从 HookManager 读取已有数据
        const allIds = hookId
          ? [hookId]
          : Array.from(
              new Set([
                ...(pageHookStore?.getHookIds() ?? []),
                ...(hookManager?.getAllKnownHookIds() ?? []),
              ]),
            );
        for (const id of allIds) {
          const pageRecords = pageHookStore?.get(id) ?? [];
          storeSnapshot[id] =
            pageRecords.length > 0
              ? pageRecords
              : (hookManager?.getRecords(id) ?? []);
        }
      }

      const filters = {type, event, phase, preserveEmpty: Boolean(hookId)};
      let data: unknown;
      if (view === 'summary') {
        data = {
          view: 'summary' as const,
          ...summarizeHookStore(storeSnapshot, filters, maxRecords),
        };
      } else if (view === 'detail') {
        data = buildDetailedView(
          filterHookStore(storeSnapshot, filters, maxRecords),
          maxRecords,
        );
      } else {
        data = filterHookStore(storeSnapshot, filters, maxRecords);
      }

      const viewLabel = getViewLabel(view);
      const scopeLabel = hookId ? ` Hook ${hookId} 的` : '全部 Hook';
      const result = {
        success: true,
        message: `已获取${scopeLabel}${viewLabel}`,
        tooltype: 'get_hook_data',
        data,
      };
      response.setStructuredContent(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `获取失败：${getErrorMessage(error)}`,
        {toolName: 'get_hook_data'},
      );
    }
  },
});

function buildDetailedView(
  storeSnapshot: Record<string, unknown[]>,
  maxRecords?: number,
) {
  const normalizedRecords = Object.entries(storeSnapshot).flatMap(
    ([currentHookId, records]) =>
      toHookRecordArray(records).map(record =>
        normalizeHookRecord({
          ...record,
          hookId: record.hookId ?? currentHookId,
        }),
      ),
  );

  const diagnostics = buildHookDiagnostics(storeSnapshot);

  return {
    view: 'detail' as const,
    totalHooks: Object.keys(storeSnapshot).length,
    totalRecords: normalizedRecords.length,
    normalizedRecords:
      typeof maxRecords === 'number' && maxRecords > 0
        ? normalizedRecords.slice(-Math.floor(maxRecords))
        : normalizedRecords,
    ...(diagnostics.length > 0 ? {diagnostics} : {}),
    summary: summarizeHookRecords(normalizedRecords, maxRecords ?? 20),
    candidateEnvNeeds: inferCandidateEnvNeeds(normalizedRecords),
    requestBindings: buildRequestBindings(normalizedRecords),
  };
}

function buildHookDiagnostics(
  storeSnapshot: Record<string, unknown[]>,
): HookDiagnostic[] {
  return Object.entries(storeSnapshot)
    .filter(([, records]) => records.length === 0)
    .map(([hookId]) => ({
      hookId,
      type: inferDiagnosticHookType(hookId),
      issue: 'hook_installed_no_records' as const,
      likelyCauses: [
        '目标业务动作尚未触发',
        'Hook 注入晚于页面签名逻辑初始化',
        '当前选中的 Frame 与请求所在 Frame 不一致',
        '目标请求未经过该 Hook 类型',
      ],
      nextSteps: [
        '触发登录、下单、分页等目标业务动作后重新读取 get_hook_data',
        '在页面加载前安装 Hook',
        '用 list_frames / select_frame 确认 Hook 注入到正确 Frame',
        '升级到 break_on_xhr、get_paused_info、evaluate_on_callframe 调试链路',
      ],
    }));
}

function inferDiagnosticHookType(hookId: string): string {
  if (hookId.includes('fetch')) return 'fetch';
  if (hookId.includes('xhr')) return 'xhr';
  if (hookId.includes('crypto')) return 'crypto';
  if (hookId.includes('storage')) return 'storage';
  if (hookId.includes('cookie')) return 'cookie';
  return 'unknown';
}

function getViewLabel(view: string | undefined): string {
  if (view === 'summary') return '摘要';
  if (view === 'detail') return '详情';
  return '数据';
}

// ─── InjectHook.ts ───────────────────────────────────────

const isolatedWarning =
  'requestedWorld isolated is not supported; effectiveWorld is main.';

export const injectHook = definePageTool({
  name: 'inject_hook',
  description:
    '向页面注入 Hook。persistent=true 时注册到当前 BrowserContext，并尽力回填当前已有 Frame。',
  annotations: {
    title: 'Inject Hook',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod.string().describe('用于日志与追踪的 Hook 标识符'),
    script: zod.string().optional().describe('要注入的 Hook 脚本代码'),
    persistent: zod
      .boolean()
      .optional()
      .describe('是否随当前 BrowserContext 持久化'),
    world: zod
      .enum(['main', 'isolated'])
      .optional()
      .describe('请求的执行 world；当前实际执行 world 始终为 main'),
  },
  handler: async (request, response, context) => {
    const {hookId} = request.params;
    const hookManager = context.getHookManager?.();
    const resolvedScript =
      request.params.script ?? hookManager?.getHook(hookId)?.script;

    if (
      !resolvedScript ||
      typeof resolvedScript !== 'string' ||
      resolvedScript.trim().length === 0
    ) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        `未找到 Hook "${hookId}" 的脚本，请提供 script 参数或先调用 create_hook`,
        {toolName: 'inject_hook', hookId},
      );
    }

    const script = resolvedScript;
    const persistent = request.params.persistent ?? false;
    const requestedWorld = request.params.world ?? 'main';
    const base: InjectHookData = {
      hookId,
      persisted: false,
      ranOnCurrentFrame: false,
      world: requestedWorld,
      requestedWorld,
      effectiveWorld: 'main',
      persistentStrategy: persistent ? 'addInitScript' : 'evaluate-once',
      warnings: requestedWorld === 'isolated' ? [isolatedWarning] : [],
    };

    try {
      if (!persistent) {
        // 必须走页面默认 world：frame.evaluate 落在 Playwright 隔离 world，
        // 注入的 Hook 读不到也改不了页面自己的 window。
        await evaluateInPageRuntime(context.getSelectedFrame(), script);
        const data = {...base, ranOnCurrentFrame: true};
        response.setStructuredContent({
          success: true,
          message: `Hook injected: ${hookId} (${requestedWorld} requested, main effective)`,
          tooltype: 'inject_hook',
          data,
        });
        return;
      }

      const browserContext = context.getBrowserContext();
      if (!browserContext || browserContext.isClosed()) {
        throw createToolError(
          ErrorCodes.BROWSER_REQUIRED,
          '当前 BrowserContext 不可用或已关闭，无法注册持久 Hook',
          {toolName: 'inject_hook'},
        );
      }
      const result = await context.getPersistentHookRegistry().register({
        context: browserContext,
        hookId,
        script,
        source: 'inject_hook',
        requestedWorld,
        applyMode: 'existing-and-future',
      });
      const data: InjectHookData = {
        ...base,
        persisted: true,
        ranOnCurrentFrame: result.appliedFrames > 0,
        requestedWorld: result.entry.requestedWorld,
        effectiveWorld: result.entry.effectiveWorld,
        applyMode: 'existing-and-future',
        registered: result.registered,
        idempotent: result.idempotent,
        appliedFrames: result.appliedFrames,
        failedFrames: result.failedFrames,
        partial: result.partial,
        warnings: result.warnings,
      };
      response.setStructuredContent({
        success: true,
        message: `Hook ${hookId} registered for the current BrowserContext`,
        tooltype: 'inject_hook',
        data,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `注入失败：${getErrorMessage(error)}`,
        {toolName: 'inject_hook', ...base},
      );
    }
  },
});

export const listPersistentHooks = defineBrowserTool({
  name: 'list_persistent_hooks',
  concurrency: 'none',
  description: '列出当前 BrowserContext 中已注册的持久 Hook。',
  annotations: {
    title: 'List Persistent Hooks',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const browserContext = context.getBrowserContext();
    if (!browserContext || browserContext.isClosed()) {
      throw createToolError(
        ErrorCodes.BROWSER_REQUIRED,
        '当前 BrowserContext 不可用或已关闭',
        {toolName: 'list_persistent_hooks'},
      );
    }
    const hooks = context
      .getPersistentHookRegistry()
      .list(browserContext)
      .map(entry => ({
        ...entry,
        registeredAt: new Date(entry.registeredAt).toISOString(),
        world: entry.requestedWorld,
        removable: false,
      }));
    response.setStructuredContent({
      success: true,
      message: `${hooks.length} persistent hook(s) registered; close or recreate the BrowserContext to clear them`,
      tooltype: 'list_persistent_hooks',
      data: {
        hooks,
        count: hooks.length,
        removable: false,
        clearBy: 'close-or-recreate-browser-context',
      },
    });
  },
});

// ─── ListCreatedHooks.ts ─────────────────────────────────

/**
 * 列出已创建的 Hook：从进程内 HookManager 获取元数据，
 * 并可选地从浏览器同步采集数据。
 *
 * 参考 old-source/src/tools/hook.ts 的 getHookData（list 部分）。
 */
export const listCreatedHooks = definePageTool({
  name: 'list_created_hooks',
  requirePage: false,
  description:
    '列出 HookManager 中所有已创建的 hook。可选地同步浏览器端数据以统计记录数。',
  annotations: {
    title: 'List Created Hooks',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    hookId: zod
      .string()
      .optional()
      .describe('指定要查看的 Hook ID，省略则返回全部'),
    verbose: zod
      .boolean()
      .optional()
      .default(false)
      .describe('包含每个 Hook 的详细记录'),
    syncFromBrowser: zod
      .boolean()
      .optional()
      .default(true)
      .describe('列出前先从浏览器同步数据（默认 true）'),
    type: zod.string().optional().describe('按 Hook 类型过滤'),
    event: zod.string().optional().describe('按事件名过滤'),
    phase: zod.string().optional().describe('按阶段过滤'),
  },
  handler: async (request, response, context) => {
    const {hookId, verbose = false, type, event, phase} = request.params;
    // 默认从浏览器同步，确保 hook_function / inject_hook / auto_hook 等
    // 仅存在于页面侧（window.__mcp_hooks__ / window.__hookStore）的 Hook
    // 也能被完整列出（修复：此前浏览器与进程内 Hook 未合并展示）。
    const syncFromBrowser = request.params.syncFromBrowser ?? true;
    const hookManager = context.getHookManager?.();

    try {
      let browserStore: Record<string, unknown[]> | null = null;
      let browserRegistry: Array<{id: string; target: string}> = [];
      if (syncFromBrowser) {
        try {
          const frame = (context as Context).getSelectedFrame();
          browserStore = await readHookStore(frame, hookId);
          browserRegistry = await readMcpHookRegistry(frame);
        } catch {
          // 浏览器不可用，跳过同步，仅返回进程内 HookManager 数据
        }
      }

      // 统一合并三个来源，按 hookId 去重：
      //   1) 进程内 HookManager（create_hook / inject_hook / auto_hook 等注册）
      //   2) 浏览器 window.__mcp_hooks__（hook_function 的活跃注册表，含 0 记录 Hook）
      //   3) 浏览器 window.__hookStore（各类 Hook 的调用记录）
      const merged = new Map<string, Record<string, unknown>>();

      // 1) HookManager
      const managerIds = hookId
        ? [hookId]
        : (hookManager?.getAllKnownHookIds() ?? []);
      for (const id of managerIds) {
        const meta = hookManager?.getHook(id);
        const records = hookManager?.getRecords(id) ?? [];
        if (!meta && records.length === 0 && !hookId) {
          continue;
        }
        const entry: Record<string, unknown> = {
          hookId: id,
          source: 'manager',
          type: meta?.type ?? 'unknown',
          description: meta?.description ?? '',
          enabled: meta?.enabled ?? true,
          callCount: meta?.callCount ?? records.length,
          recordCount: records.length,
        };
        if (verbose && records.length > 0) {
          entry.recentRecords = records.slice(-10);
        }
        if (meta?.script) {
          entry.scriptLength = meta.script.length;
        }
        merged.set(id, entry);
      }

      // 2) window.__mcp_hooks__（活跃注册表）
      for (const reg of browserRegistry) {
        if (hookId && reg.id !== hookId) {
          continue;
        }
        const existing = merged.get(reg.id);
        if (existing) {
          existing.browserActive = true;
          if (!existing.target) {
            existing.target = reg.target;
          }
        } else {
          merged.set(reg.id, {
            hookId: reg.id,
            source: 'browser',
            type: 'function',
            target: reg.target,
            enabled: true,
            browserActive: true,
            recordCount: 0,
          });
        }
      }

      // 3) window.__hookStore（调用记录）
      if (browserStore && typeof browserStore === 'object') {
        const summary = summarizeHookStore(browserStore, {
          preserveEmpty: Boolean(hookId) || (!type && !event && !phase),
          type,
          event,
          phase,
        });
        for (const h of summary.hooks) {
          if (hookId && h.hookId !== hookId) {
            continue;
          }
          const existing = merged.get(h.hookId);
          if (existing) {
            existing.browserRecordCount = h.total;
            if (!existing.type || existing.type === 'unknown') {
              existing.type = h.type;
            }
            if (verbose && h.recentRecords.length > 0) {
              existing.browserRecentRecords = h.recentRecords.slice(-10);
            }
          } else {
            const entry: Record<string, unknown> = {
              hookId: h.hookId,
              source: 'browser',
              type: h.type,
              enabled: true,
              recordCount: h.total,
              browserRecordCount: h.total,
            };
            if (verbose && h.recentRecords.length > 0) {
              entry.browserRecentRecords = h.recentRecords.slice(-10);
            }
            merged.set(h.hookId, entry);
          }
        }
      }

      const hooks = Array.from(merged.values());
      const totalRecords = hooks.reduce(
        (sum, h) => sum + Number(h.browserRecordCount ?? h.recordCount ?? 0),
        0,
      );

      if (browserStore && typeof browserStore === 'object') {
        const summary = summarizeHookStore(browserStore, {
          preserveEmpty: Boolean(hookId) || (!type && !event && !phase),
          type,
          event,
          phase,
        });
        response.setStructuredContent({
          success: true,
          message: `同步完成，${summary.totalHooks} 个 Hook，共 ${summary.totalRecords} 条记录`,
          tooltype: 'list_created_hooks',
          syncedHookIds: summary.hooks.map(h => h.hookId),
          totalRecords: summary.totalRecords,
          hooks: verbose
            ? summary.hooks
            : summary.hooks.map(h => ({
                hookId: h.hookId,
                total: h.total,
                type: h.type,
              })),
        });
        return;
      }

      response.setStructuredContent({
        success: true,
        message: `共 ${hooks.length} 个 Hook`,
        tooltype: 'list_created_hooks',
        syncedHookIds: hooks.map(h => String(h.hookId)),
        totalRecords,
        hooks,
        data: {
          totalHooks: hooks.length,
          totalEnabled: hooks.filter(h => h.enabled !== false).length,
          totalDisabled: hooks.filter(h => h.enabled === false).length,
          totalRecords,
          hooks,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `列出 Hook 失败：${getErrorMessage(error)}`,
        {toolName: 'list_created_hooks'},
      );
    }
  },
});

// ─── RemoveHook.ts ───────────────────────────────────────

/**
 * 移除 Hook：从进程内 HookManager 删除 hook 元数据和记录，
 * 并可选地清理浏览器端 __hookStore 中的数据。
 *
 * 参考 old-source/src/tools/hook.ts 的 removeHook。
 */
export const removeHook = definePageTool({
  name: 'remove_hook',
  requirePage: false,
  description:
    '按 ID 移除 hook：从进程内 HookManager 与 PageHookStore 删除，并在浏览器侧还原已包裹的 PageHook 原函数引用、清理 __hookStore 数据。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod.string().describe('要移除的 Hook ID'),
    cleanBrowser: zod
      .boolean()
      .optional()
      .default(true)
      .describe('同时还原页面端 PageHook 原函数并清理 hook 数据（默认：true）'),
  },
  handler: async (request, response, context) => {
    const {hookId, cleanBrowser = true} = request.params;
    const hookManager = context.getHookManager?.();

    if (!hookId) {
      throw createToolError(ErrorCodes.VALIDATION, 'hookId 参数不能为空', {
        toolName: 'remove_hook',
      });
    }

    const removed = hookManager?.remove(hookId) ?? false;
    context.getPageHookStore?.()?.clear(hookId);

    let restored = false;
    let browserCleaned = false;
    if (cleanBrowser) {
      try {
        const frame = (context as Context).getSelectedFrame();
        const serializedHookId = JSON.stringify(hookId);
        // 必须走页面默认 world：frame.evaluate 落在 Playwright 隔离 world，
        // 既触不到页面自己的 window.__mcp_hooks__ 还原句柄，也删不到 window.__hookStore。
        const cleanup = await evaluateInPageRuntime<
          boolean | {restored?: boolean; storeCleaned?: boolean}
        >(
          frame,
          `
          (function(){
            var hookId = ${serializedHookId};
            var restored = false;
            var storeCleaned = false;
            var reg = window.__mcp_hooks__;
            if (reg && reg[hookId]) {
              var entry = reg[hookId];
              try {
                if (typeof entry.restore === 'function') {
                  entry.restore();
                  restored = true;
                } else if (entry.obj && entry.methodName && 'original' in entry) {
                  entry.obj[entry.methodName] = entry.original;
                  restored = true;
                }
              } catch (e) {}
              delete reg[hookId];
            }
            var s = window.${HOOK_STORE_KEY};
            if (s && s[hookId]) {
              delete s[hookId];
              storeCleaned = true;
            }
            return { restored: restored, storeCleaned: storeCleaned };
          })()
        `,
        );
        if (typeof cleanup === 'boolean') {
          browserCleaned = cleanup;
        } else {
          restored = cleanup?.restored === true;
          browserCleaned = restored || cleanup?.storeCleaned === true;
        }
      } catch {
        // 页面可能已关闭、调试器暂停或不可用，忽略浏览器端清理错误
      }
    }

    if (!removed && !browserCleaned) {
      throw createToolError(ErrorCodes.NOT_FOUND, `Hook 未找到：${hookId}`, {
        toolName: 'remove_hook',
        hookId,
      });
    }

    // 管理器里没有、但页面 __mcp_hooks__ / __hookStore 里清掉了：hook 只存在于页面侧，
    // 这时按浏览器端清理结果报告成功。
    if (!removed) {
      response.setStructuredContent({
        success: true,
        message: restored
          ? `浏览器端 PageHook 已还原并清理：${hookId}`
          : `浏览器端 Hook 数据已清理：${hookId}`,
        tooltype: 'remove_hook',
        hookId,
        ...(restored ? {data: {hookId, restored, browserCleaned}} : {}),
      });
      return;
    }

    response.setStructuredContent({
      success: true,
      message: restored
        ? `Hook 已移除并还原原函数：${hookId}`
        : `Hook 已移除：${hookId}`,
      tooltype: 'remove_hook',
      hookId,
      data: {
        hookId,
        restored,
        browserCleaned,
      },
    });
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'hook',
  description: 'JavaScript runtime hook creation and management tools.',
  profile: 'workflow',
  prerequisites: {
    injectHook: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
  },
  toolDependencies: [
    {from: 'injectHook', to: 'createHook', relation: 'requires', weight: 1},
  ],
  sceneKeywords: {
    createHook: ['hook', 'function', 'fetch', 'xhr', 'cookie', 'PageHook'],
    injectHook: ['inject', 'runtime', 'instrumentation', 'PersistentHook'],
  },
  tools: [
    {modulePath: './hook.js', handlerName: 'createHook'},
    {modulePath: './hook.js', handlerName: 'injectHook'},
    {modulePath: './hook.js', handlerName: 'listPersistentHooks'},
    {modulePath: './hook.js', handlerName: 'getHookData'},
    {modulePath: './hook.js', handlerName: 'removeHook'},
    {modulePath: './hook.js', handlerName: 'listCreatedHooks'},
  ],
} satisfies DomainManifest;
