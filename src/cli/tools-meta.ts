/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolMeta 注册表 — 从 defineTool 定义动态加载 name / description / schema
 *
 * 不再手动维护 TOOLS_META 数组。每个工具只需在此声明 modulePath + handlerName，
 * name / description / schema 从对应 defineTool 的导出自动提取。
 */

import type {ToolDefinition} from '../tools/ToolDefinition.js';
import {
  extractArgSpecsFromSchema,
  extractSchemaTypeMap,
  type ToolArgSpec,
  type ToolArgSpecMap,
} from './zod-introspect.js';

export type ToolCallMode = 'defineTool';

/**
 * 工具注册条目 — 仅声明模块路径与导出名，其余从 defineTool 自动提取
 */
export interface ToolRegistryEntry {
  modulePath: string;
  handlerName: string;
}

/**
 * 完整工具元信息 — CLI 使用
 */
export interface ToolMeta {
  name: string;
  description: string;
  /** 简化类型映射 (key → 'string'|'number'|'boolean'|'string[]') */
  schema: Record<string, string>;
  /** 丰富的参数规格（含 required / enum / defaultValue / description） */
  argSpecs: ToolArgSpecMap;
  modulePath: string;
  handlerName: string;
  callMode: ToolCallMode;
}

/**
 * 工具注册表 — 只需声明 modulePath 和 handlerName
 * name / description / schema 从 defineTool 自动提取
 */
const TOOL_REGISTRY: ToolRegistryEntry[] = [
  // ── pipeline ──────────────────────────────────
  {modulePath: './pipeline/examples.js', handlerName: 'analyzePipeline'},
  // ── workflow ──────────────────────────────────
  {modulePath: './workflow/observeFlow.js', handlerName: 'observeFlow'},
  {modulePath: './workflow/autoHook.js', handlerName: 'autoHook'},
  {modulePath: './workflow/rebuildBundle.js', handlerName: 'rebuildBundle'},
  {
    modulePath: './workflow/traceSignatureGeneration.js',
    handlerName: 'traceSignatureGeneration',
  },
  // ── dom ───────────────────────────────────────
  {modulePath: './dom/queryDom.js', handlerName: 'queryDom'},
  {modulePath: './dom/getDomStructure.js', handlerName: 'getDomStructure'},
  {
    modulePath: './dom/findClickableElements.js',
    handlerName: 'findClickableElements',
  },
  // ── network ───────────────────────────────────
  {
    modulePath: './network/listNetworkRequests.js',
    handlerName: 'listNetworkRequests',
  },
  {
    modulePath: './network/getNetworkRequest.js',
    handlerName: 'getNetworkRequest',
  },
  // ── input ──────────────────────────────────────
  {modulePath: './input/click.js', handlerName: 'click'},
  {modulePath: './input/pressKey.js', handlerName: 'pressKey'},
  {modulePath: './input/fillForm.js', handlerName: 'fillForm'},
  {modulePath: './input/uploadFile.js', handlerName: 'uploadFile'},
  {modulePath: './input/hover.js', handlerName: 'hover'},
  {modulePath: './input/drag.js', handlerName: 'drag'},
  {modulePath: './input/clickAt.js', handlerName: 'clickAt'},
  {modulePath: './input/setFiles.js', handlerName: 'setFiles'},
  {modulePath: './input/fill.js', handlerName: 'fill'},
  // ── page ───────────────────────────────────────
  {modulePath: './page/clickElement.js', handlerName: 'clickElement'},
  {modulePath: './page/typeText.js', handlerName: 'typeText'},
  {modulePath: './page/waitForElement.js', handlerName: 'waitForElement'},
  {modulePath: './page/scrollBy.js', handlerName: 'scrollBy'},
  {modulePath: './page/sessionState.js', handlerName: 'saveSessionState'},
  {modulePath: './page/sessionState.js', handlerName: 'restoreSessionState'},
  {modulePath: './page/sessionState.js', handlerName: 'listSessionStates'},
  {modulePath: './page/sessionState.js', handlerName: 'deleteSessionState'},
  {modulePath: './page/sessionState.js', handlerName: 'dumpSessionState'},
  {modulePath: './page/sessionState.js', handlerName: 'loadSessionState'},
  {
    modulePath: './page/checkBrowserHealth.js',
    handlerName: 'checkBrowserHealth',
  },
  // ── navigation ─────────────────────────────────
  {modulePath: './navigation/listPages.js', handlerName: 'listPages'},
  {modulePath: './navigation/selectPage.js', handlerName: 'selectPage'},
  {modulePath: './navigation/newPage.js', handlerName: 'newPage'},
  {modulePath: './navigation/navigatePage.js', handlerName: 'navigatePage'},
  // ── screenshot ─────────────────────────────────
  {modulePath: './screenshot/takeScreenshot.js', handlerName: 'takeScreenshot'},
  {
    modulePath: './screenshot/captureVideoFrame.js',
    handlerName: 'captureVideoFrame',
  },
  {modulePath: './screenshot/getVideoInfo.js', handlerName: 'getVideoInfo'},
  {modulePath: './screenshot/seekVideo.js', handlerName: 'seekVideo'},
  // ── emulation ──────────────────────────────────
  {modulePath: './emulation/emulateMobile.js', handlerName: 'emulateMobile'},
  {modulePath: './emulation/emulateNetwork.js', handlerName: 'emulateNetwork'},
  {modulePath: './emulation/emulateCpu.js', handlerName: 'emulateCpu'},
  {modulePath: './emulation/resizePage.js', handlerName: 'resizePage'},
  // ── stealth ────────────────────────────────────
  {modulePath: './stealth/stealth.js', handlerName: 'setUserAgent'},
  {modulePath: './stealth/stealth.js', handlerName: 'injectStealth'},
  {modulePath: './stealth/stealth.js', handlerName: 'listStealthFeatures'},
  {modulePath: './stealth/stealth.js', handlerName: 'listStealthPresets'},
  // ── performance ─────────────────────────────────
  {
    modulePath: './performance/startPerformanceTrace.js',
    handlerName: 'startPerformanceTrace',
  },
  {
    modulePath: './performance/stopPerformanceTrace.js',
    handlerName: 'stopPerformanceTrace',
  },
  {
    modulePath: './performance/getPerformanceMetrics.js',
    handlerName: 'getPerformanceMetrics',
  },
  {
    modulePath: './performance/performanceAnalyzeInsight.js',
    handlerName: 'performanceAnalyzeInsight',
  },
  // ── debugger ───────────────────────────────────
  {modulePath: './debugger/index.js', handlerName: 'setBreakpoint'},
  {modulePath: './debugger/index.js', handlerName: 'removeBreakpoint'},
  {modulePath: './debugger/index.js', handlerName: 'listBreakpoints'},
  {modulePath: './debugger/index.js', handlerName: 'stepInto'},
  {modulePath: './debugger/index.js', handlerName: 'stepOver'},
  {modulePath: './debugger/index.js', handlerName: 'stepOut'},
  {modulePath: './debugger/index.js', handlerName: 'resume'},
  {modulePath: './debugger/index.js', handlerName: 'pause'},
  {modulePath: './debugger/index.js', handlerName: 'listScripts'},
  {modulePath: './debugger/index.js', handlerName: 'getScriptSource'},
  {modulePath: './debugger/index.js', handlerName: 'searchInSources'},
  {modulePath: './debugger/getStorage.js', handlerName: 'getStorage'},
  {modulePath: './debugger/index.js', handlerName: 'breakOnXhr'},
  {modulePath: './debugger/index.js', handlerName: 'removeXhrBreakpoint'},
  {modulePath: './debugger/monitorEvents.js', handlerName: 'monitorEvents'},
  {modulePath: './debugger/stopMonitor.js', handlerName: 'stopMonitor'},
  {modulePath: './debugger/index.js', handlerName: 'traceFunction'},
  {modulePath: './debugger/index.js', handlerName: 'getAiDebugStatus'},
  {modulePath: './debugger/inspectObject.js', handlerName: 'inspectObject'},
  {modulePath: './debugger/listHooks.js', handlerName: 'listHooks'},
  {modulePath: './debugger/index.js', handlerName: 'findInScript'},
  {modulePath: './debugger/index.js', handlerName: 'getRequestInitiator'},
  {modulePath: './debugger/index.js', handlerName: 'getPausedInfo'},
  {
    modulePath: './debugger/index.js',
    handlerName: 'evaluateOnCallframe',
  },
  {modulePath: './debugger/index.js', handlerName: 'inspectLocals'},
  {
    modulePath: './debugger/index.js',
    handlerName: 'setBreakpointOnText',
  },
  {modulePath: './debugger/hookFunction.js', handlerName: 'hookFunction'},
  {
    modulePath: './debugger/unhookFunction.js',
    handlerName: 'unhookFunction',
  },
  {
    modulePath: './debugger/index.js',
    handlerName: 'xhrToJsBreakpoint',
  },
  {
    modulePath: './debugger/index.js',
    handlerName: 'startContinuousDebugging',
  },
  {
    modulePath: './debugger/index.js',
    handlerName: 'stopContinuousDebugging',
  },
  // ── hook ────────────────────────────────────────
  {modulePath: './hook/CreateHook.js', handlerName: 'createHook'},
  {modulePath: './hook/InjectHook.js', handlerName: 'injectHook'},
  {modulePath: './hook/InjectHook.js', handlerName: 'listPersistentHooks'},
  {modulePath: './hook/GetHookData.js', handlerName: 'getHookData'},
  {modulePath: './hook/RemoveHook.js', handlerName: 'removeHook'},
  {modulePath: './hook/ListCreatedHooks.js', handlerName: 'listCreatedHooks'},
  {modulePath: './hook/XhrOpen.js', handlerName: 'hookXhrOpen'},
  {
    modulePath: './hook/XhrSetRequestHeader.js',
    handlerName: 'hookXhrSetRequestHeader',
  },
  {modulePath: './hook/Fetch.js', handlerName: 'hookFetch'},
  {modulePath: './hook/AnalyzeUrlParams.js', handlerName: 'analyzeUrlParams'},
  {modulePath: './hook/Cookie.js', handlerName: 'hookCookie'},
  {modulePath: './hook/WebSocket.js', handlerName: 'hookWebSocket'},
  {modulePath: './hook/JsonParse.js', handlerName: 'hookJsonParse'},
  {modulePath: './hook/JsonStringify.js', handlerName: 'hookJsonStringify'},
  {modulePath: './hook/LocalStorage.js', handlerName: 'hookLocalStorage'},
  {
    modulePath: './hook/SessionStorage.js',
    handlerName: 'hookSessionStorage',
  },
  {modulePath: './hook/DateNow.js', handlerName: 'hookDateNow'},
  {
    modulePath: './hook/PerformanceNow.js',
    handlerName: 'hookPerformanceNow',
  },
  {modulePath: './hook/Random.js', handlerName: 'hookRandom'},
  {modulePath: './hook/Promise.js', handlerName: 'hookPromise'},
  {modulePath: './hook/History.js', handlerName: 'hookHistory'},
  {modulePath: './hook/HistoryGo.js', handlerName: 'hookHistoryGo'},
  {modulePath: './hook/LocationHref.js', handlerName: 'hookLocationHref'},
  {modulePath: './hook/Close.js', handlerName: 'hookClose'},
  {modulePath: './hook/ConsoleLog.js', handlerName: 'hookConsoleLog'},
  {modulePath: './hook/ConsoleClear.js', handlerName: 'hookConsoleClear'},
  {
    modulePath: './hook/ConsoleProtect.js',
    handlerName: 'hookConsoleProtect',
  },
  {modulePath: './hook/ConsoleTable.js', handlerName: 'hookConsoleTable'},
  {
    modulePath: './hook/fixedWindowSize.js',
    handlerName: 'fixedWindowSize',
  },
  {modulePath: './hook/antiAntiHook.js', handlerName: 'antiAntiHook'},
  // ── dialog ──────────────────────────────────────
  {modulePath: './dialog/handleDialog.js', handlerName: 'handleDialog'},
  // ── frames ──────────────────────────────────────
  {modulePath: './frames/listFrames.js', handlerName: 'listFrames'},
  {modulePath: './frames/selectFrame.js', handlerName: 'selectFrame'},
  // ── script ──────────────────────────────────────
  {modulePath: './script/script.js', handlerName: 'evaluateScript'},
  {
    modulePath: './script/script.js',
    handlerName: 'injectPreloadScript',
  },
  // ── site-experience ──────────────────────────────
  {
    modulePath: './site-experience/siteExperience.js',
    handlerName: 'searchSiteExperience',
  },
  {
    modulePath: './site-experience/siteExperience.js',
    handlerName: 'listSiteExperiences',
  },
  {
    modulePath: './site-experience/siteExperience.js',
    handlerName: 'createSiteExperience',
  },
  {
    modulePath: './site-experience/siteExperience.js',
    handlerName: 'updateSiteExperience',
  },
  {
    modulePath: './site-experience/siteExperience.js',
    handlerName: 'deleteSiteExperience',
  },
  // ── extensions ──────────────────────────────────
  {
    modulePath: './extensions/updateExtensions.js',
    handlerName: 'updateExtensions',
  },
  // ── analyzer ────────────────────────────────────
  {modulePath: './analyzer/deobfuscate.js', handlerName: 'deobfuscateCode'},
  {modulePath: './analyzer/understand.js', handlerName: 'understandCode'},
  {modulePath: './analyzer/summarize.js', handlerName: 'summarizeCode'},
  {modulePath: './analyzer/detectCrypto.js', handlerName: 'detectCrypto'},
  {
    modulePath: './analyzer/reports.js',
    handlerName: 'record_reverse_evidence',
  },
  {modulePath: './analyzer/analyzeTarget.js', handlerName: 'analyze_target'},
  {modulePath: './analyzer/riskPanel.js', handlerName: 'riskPanel'},
  {
    modulePath: './analyzer/reports.js',
    handlerName: 'export_session_report',
  },
  // ── collector ───────────────────────────────────
  {modulePath: './collector/collectCode.js', handlerName: 'collectCode'},
  {
    modulePath: './collector/collectionDiff.js',
    handlerName: 'collectionDiff',
  },
  {
    modulePath: './collector/searchInScripts.js',
    handlerName: 'searchInScripts',
  },
  // ── rebuild ─────────────────────────────────────
  {
    modulePath: './rebuild/index.js',
    handlerName: 'exportRebuildBundle',
  },
  {
    modulePath: './rebuild/index.js',
    handlerName: 'diffEnvRequirements',
  },
  // ── anti-debug ──────────────────────────────────
  {
    modulePath: './anti-debug/antiAntiDebug.js',
    handlerName: 'antiAntiDebug',
  },
  {
    modulePath: './anti-debug/bypassDebugger.js',
    handlerName: 'bypassDebugger',
  },
  // ── crypto ──────────────────────────────────────
  {modulePath: './crypto/hookCryptoJS.js', handlerName: 'hookCryptoJS'},
  {modulePath: './crypto/hookJSEncrypt.js', handlerName: 'hookJSEncrypt'},
  {modulePath: './crypto/hookSMCrypto.js', handlerName: 'hookSMCrypto'},
  // ── wasm ────────────────────────────────────────
  {modulePath: './wasm/index.js', handlerName: 'wasmCapabilities'},
  {modulePath: './wasm/index.js', handlerName: 'wasmDump'},
  {modulePath: './wasm/index.js', handlerName: 'wasmDisassemble'},
  {modulePath: './wasm/index.js', handlerName: 'wasmDecompile'},
  {modulePath: './wasm/index.js', handlerName: 'wasmInspectSections'},
  {modulePath: './wasm/index.js', handlerName: 'wasmOfflineRun'},
  {modulePath: './wasm/index.js', handlerName: 'wasmOptimize'},
  {modulePath: './wasm/index.js', handlerName: 'wasmVmpTrace'},
  {modulePath: './wasm/index.js', handlerName: 'wasmMemoryInspect'},
  // ── vue ──────────────────────────────────────────
  {
    modulePath: './vue/activateVueDevtools.js',
    handlerName: 'activateVueDevtools',
  },
  {modulePath: './vue/clearVueGuards.js', handlerName: 'clearVueGuards'},
  {modulePath: './vue/getVueRoutes.js', handlerName: 'getVueRoutes'},
  // ── vjstools ────────────────────────────────────
  {
    modulePath: './vjstools/deobfuscate.js',
    handlerName: 'deobfuscateCodeVj',
  },
  {modulePath: './vjstools/deobfuscate.js', handlerName: 'minifyCode'},
  {
    modulePath: './vjstools/deobfuscate.js',
    handlerName: 'transpileCodeTool',
  },
  {modulePath: './vjstools/deobfuscate.js', handlerName: 'analyzeAstTool'},
  {modulePath: './vjstools/deobfuscate.js', handlerName: 'diffCodeTool'},
  // ── code-templates ──────────────────────────────
  {
    modulePath: './code-templates/getCodeTemplate.js',
    handlerName: 'getCodeTemplate',
  },
  {
    modulePath: './code-templates/injectCodeTemplate.js',
    handlerName: 'injectCodeTemplate',
  },
  {
    modulePath: './code-templates/listCodeTemplates.js',
    handlerName: 'listCodeTemplates',
  },
  // ── console ──────────────────────────────────────
  {
    modulePath: './console/listConsoleMessages.js',
    handlerName: 'listConsoleMessages',
  },
  {
    modulePath: './console/getConsoleMessage.js',
    handlerName: 'getConsoleMessage',
  },
  // ── websocket (in network/) ─────────────────────
  {
    modulePath: './network/listConnections.js',
    handlerName: 'listWebSocketConnections',
  },
  {
    modulePath: './network/getMessages.js',
    handlerName: 'getWebSocketMessages',
  },
  {
    modulePath: './network/getMessage.js',
    handlerName: 'getWebSocketMessage',
  },
  {
    modulePath: './network/analyzeMessages.js',
    handlerName: 'analyzeWebSocketMessages',
  },
];

// ─── 动态加载缓存 ──────────────────────────────────────

let toolsMetaCache: ToolMeta[] | null = null;
let toolsByNameCache: Map<string, ToolMeta> | null = null;

/**
 * 从 defineTool 模块中提取 ToolMeta
 */
async function loadToolMeta(
  entry: ToolRegistryEntry,
): Promise<ToolMeta | null> {
  try {
    const modulePath = `../tools${entry.modulePath.replace(/^\./, '')}`;
    const module = await import(modulePath);
    const handler = module[entry.handlerName];

    if (!handler) {
      console.warn(
        `[tools-meta] ${entry.modulePath} 中未找到导出 ${entry.handlerName}`,
      );
      return null;
    }

    // defineTool 返回 ToolDefinition 对象
    if (typeof handler === 'object' && handler !== null && typeof handler.handler === 'function') {
      const def = handler as ToolDefinition;
      const argSpecs = extractArgSpecsFromSchema(def.schema);
      const schemaTypeMap = extractSchemaTypeMap(def.schema);

      return {
        name: def.name,
        description: def.description,
        schema: schemaTypeMap,
        argSpecs,
        modulePath: entry.modulePath,
        handlerName: entry.handlerName,
        callMode: 'defineTool',
      };
    }

    console.warn(
      `[tools-meta] ${entry.modulePath}:${entry.handlerName} 不是 defineTool 定义`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[tools-meta] 加载 ${entry.modulePath}:${entry.handlerName} 失败: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

/**
 * 初始化/获取 ToolMeta 列表（懒加载 + 缓存）
 */
async function getToolsMeta(): Promise<ToolMeta[]> {
  if (toolsMetaCache) return toolsMetaCache;

  const results = await Promise.all(TOOL_REGISTRY.map(loadToolMeta));
  toolsMetaCache = results.filter((m): m is ToolMeta => m !== null);

  toolsByNameCache = new Map(
    toolsMetaCache.map(t => [t.name, t]),
  );

  return toolsMetaCache;
}

/**
 * 同步获取已缓存的 ToolMeta 列表（未初始化时返回空数组）
 */
function getCachedToolsMeta(): ToolMeta[] {
  return toolsMetaCache ?? [];
}

/**
 * 同步获取已缓存的 ToolMeta name → meta 映射
 */
function getCachedToolsByName(): Map<string, ToolMeta> {
  return toolsByNameCache ?? new Map();
}

// ─── 公共 API ────────────────────────────────────────────

/**
 * 获取工具的完整元信息（异步，从 defineTool 提取）
 */
export async function getToolMetaAsync(
  name: string,
): Promise<ToolMeta | undefined> {
  const meta = await getToolsMeta();
  return meta.find(t => t.name === name);
}

/**
 * 获取工具的完整元信息（同步，依赖已初始化的缓存）
 *
 * 如果缓存未初始化，回退到从 TOOL_REGISTRY 中查找条目并
 * 返回仅包含 modulePath/handlerName 的最小 meta。
 * 在 CLI 调用场景中，通常先调用 ensureToolsMeta() 初始化缓存。
 */
export function getToolMeta(name: string): ToolMeta | undefined {
  return getCachedToolsByName().get(name);
}

/**
 * 确保工具元信息已从 defineTool 加载（应在使用 getToolMeta 前调用）
 */
export async function ensureToolsMeta(): Promise<void> {
  await getToolsMeta();
}

/**
 * 获取所有工具名称
 */
export function getAllToolNames(): string[] {
  const cached = getCachedToolsMeta();
  if (cached.length > 0) {
    return cached.map(t => t.name);
  }
  // 回退：从注册表推导名称（需要 name，但还没加载）
  // 此处返回空数组，应先调用 ensureToolsMeta()
  return [];
}

/**
 * 搜索工具
 */
export async function searchTools(query: string): Promise<ToolMeta[]> {
  const meta = await getToolsMeta();
  const lower = query.toLowerCase();
  return meta.filter(
    t =>
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower),
  );
}

/**
 * 获取工具的参数规格（含 required / enum / defaultValue / description）
 */
export async function getToolArgSpecs(
  name: string,
): Promise<ToolArgSpecMap | undefined> {
  const meta = await getToolMetaAsync(name);
  return meta?.argSpecs;
}

/**
 * 获取所有已加载的 ToolMeta（同步，需先调用 ensureToolsMeta）
 */
export function getAllToolsMeta(): ToolMeta[] {
  return getCachedToolsMeta();
}
