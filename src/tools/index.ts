/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

// 导入所有工具
import {
  deobfuscateCode,
  understandCode,
  summarizeCode,
  detectCrypto,
  recordReverseEvidence,
  analyzeTarget,
  riskPanel,
  exportSessionReport,
} from './analyzer.js';
import {antiAntiDebug} from './anti-debug/antiAntiDebug.js';
import {bypassDebugger} from './anti-debug/bypassDebugger.js';
import {getCodeTemplate, listCodeTemplates} from './code-templates.js';
import {collectCode, collectionDiff, searchInScripts} from './collector.js';
import {listConsoleMessages, getConsoleMessage} from './console.js';
import {hookCryptoJS} from './crypto/hookCryptoJS.js';
import {hookJSEncrypt} from './crypto/hookJSEncrypt.js';
import {hookSMCrypto} from './crypto/hookSMCrypto.js';
import {
  setBreakpoint,
  removeBreakpoint,
  listBreakpoints,
  stepInto,
  stepOver,
  stepOut,
  resume,
  pause,
  listScripts,
  getScriptSource,
  searchInSources,
  getStorage,
  breakOnXhr,
  removeXhrBreakpoint,
  monitorEvents,
  stopMonitor,
  traceFunction,
  getAiDebugStatus,
  inspectObject,
  listHooks,
  findInScript,
  getRequestInitiator,
  getPausedInfo,
  evaluateOnCallframe,
  setBreakpointOnText,
  hookFunction,
  unhookFunction,
  xhrToJsBreakpoint,
  startContinuousDebugging,
  stopContinuousDebugging,
} from './debugger.js';
import {handleDialog} from './dialog.js';
import {queryDom, getDomStructure, findClickableElements} from './dom.js';
import {
  emulateMobile,
  emulateNetwork,
  emulateCpu,
  resizePage,
} from './emulation.js';
import {updateExtensions} from './extensions.js';
import {listFrames, selectFrame} from './frames.js';
import {antiAntiHook} from './hook/antiAntiHook.js';
import {fixedWindowSize} from './hook/fixedWindowSize.js';
import {hookClose} from './hook/hookClose.js';
import {hookConsoleClear} from './hook/hookConsoleClear.js';
import {hookConsoleLog} from './hook/hookConsoleLog.js';
import {hookConsoleProtect} from './hook/hookConsoleProtect.js';
import {hookConsoleTable} from './hook/hookConsoleTable.js';
import {hookCookie} from './hook/hookCookie.js';
import {hookDateNow} from './hook/hookDateNow.js';
import {hookFetch} from './hook/hookFetch.js';
import {hookHistory} from './hook/hookHistory.js';
import {hookHistoryGo} from './hook/hookHistoryGo.js';
import {hookJsonParse} from './hook/hookJsonParse.js';
import {hookJsonStringify} from './hook/hookJsonStringify.js';
import {hookLocalStorage} from './hook/hookLocalStorage.js';
import {hookLocationHref} from './hook/hookLocationHref.js';
import {hookPerformanceNow} from './hook/hookPerformanceNow.js';
import {hookPromise} from './hook/hookPromise.js';
import {hookRandom} from './hook/hookRandom.js';
import {hookSessionStorage} from './hook/hookSessionStorage.js';
import {hookWebSocket} from './hook/hookWebSocket.js';
import {hookXhrOpen} from './hook/hookXhrOpen.js';
import {hookXhrSetRequestHeader} from './hook/hookXhrSetRequestHeader.js';
import {
  createHook,
  injectHook,
  listCreatedHooks,
  getHookData,
  removeHook,
} from './hook.js';
import {
  click,
  pressKey,
  fillForm,
  uploadFile,
  hover,
  drag,
  clickAt,
  setFiles,
  fill,
} from './input.js';
import {listNetworkRequests, getNetworkRequest} from './network.js';
import {
  waitForElement,
  scrollBy,
  saveSessionState,
  restoreSessionState,
  listSessionStates,
  deleteSessionState,
  dumpSessionState,
  loadSessionState,
  checkBrowserHealth,
  clickElement,
  typeText,
} from './page.js';
import {listPages, selectPage, newPage, navigatePage} from './pages.js';
import {
  startPerformanceTrace,
  stopPerformanceTrace,
  getPerformanceMetrics,
  performanceAnalyzeInsight,
} from './performance.js';
import {exportRebuildBundle, diffEnvRequirements} from './rebuild.js';
import {
  screenshot,
  captureVideoFrame,
  getVideoInfo,
  seekVideo,
} from './screenshot.js';
import {evaluateScript, injectPreloadScript} from './script.js';
import {
  searchSiteExperience,
  listSiteExperiences,
  createSiteExperience,
  updateSiteExperience,
  deleteSiteExperience,
} from './siteExperience.js';
import {invokeSkill, listSkills} from './skill.js';
import {
  injectStealth,
  listStealthFeatures,
  listStealthPresets,
  setUserAgent,
} from './stealth.js';
// v_jstools 迁移工具
import type {JSHookToolDefinition} from './ToolRegistry.js';
import {ToolRegistry} from './ToolRegistry.js';
import {
  deobfuscateCodeVJ,
  minifyCode,
  transpileCode,
  analyzeAst,
  diffCode,
} from './v-jstools.js';
// 反调试工具
// 加密库 Hook 工具
// Vue 工具
// Hook 工具 (AntiDebug_Breaker 迁移)
import {activateVueDevtools} from './vue/activateVueDevtools.js';
import {clearVueGuards} from './vue/clearVueGuards.js';
import {getVueRoutes} from './vue/getVueRoutes.js';
import {
  listWebSocketConnections,
  getWebSocketMessages,
  getWebSocketMessage,
  analyzeWebSocketMessages,
} from './websocket.js';

const registry = new ToolRegistry();

/**
 * 注册所有内置工具
 */
export function registerBuiltInTools(): void {
  // Idempotent: skip if already registered (e.g., auto-registered on module load)
  if (registry.values().length > 0) return;

  registry.registerMany([
    // 技能工具
    invokeSkill,
    listSkills,

    // DOM 工具
    queryDom,
    getDomStructure,
    findClickableElements,

    // 网络工具
    listNetworkRequests,
    getNetworkRequest,

    // 控制台工具
    listConsoleMessages,
    getConsoleMessage,

    // WebSocket 工具
    listWebSocketConnections,
    getWebSocketMessages,
    getWebSocketMessage,
    analyzeWebSocketMessages,

    // 输入工具
    click,
    clickAt,
    pressKey,
    fillForm,
    fill,
    uploadFile,
    hover,
    drag,
    setFiles,

    // 导航工具
    clickElement,
    typeText,
    waitForElement,
    scrollBy,

    // 页面工具
    listPages,
    selectPage,
    newPage,
    navigatePage,

    // 截图工具
    screenshot,
    captureVideoFrame,
    getVideoInfo,
    seekVideo,

    // 模拟工具
    emulateMobile,
    emulateNetwork,
    emulateCpu,
    resizePage,

    // 性能工具
    startPerformanceTrace,
    stopPerformanceTrace,
    getPerformanceMetrics,
    performanceAnalyzeInsight,

    // 调试工具
    setBreakpoint,
    removeBreakpoint,
    listBreakpoints,
    stepInto,
    stepOver,
    stepOut,
    resume,
    pause,
    listScripts,
    getScriptSource,
    searchInSources,
    getStorage,
    breakOnXhr,
    removeXhrBreakpoint,
    monitorEvents,
    stopMonitor,
    traceFunction,
    getAiDebugStatus,
    inspectObject,
    listHooks,
    findInScript,
    getRequestInitiator,
    getPausedInfo,
    evaluateOnCallframe,
    setBreakpointOnText,
    hookFunction,
    unhookFunction,
    xhrToJsBreakpoint,
    startContinuousDebugging,
    stopContinuousDebugging,

    // Hook 工具
    createHook,
    injectHook,
    listCreatedHooks,
    getHookData,
    removeHook,

    // 对话框工具
    handleDialog,

    // 框架工具
    listFrames,
    selectFrame,

    // 脚本工具
    evaluateScript,
    injectPreloadScript,

    // 站点经验工具
    searchSiteExperience,
    listSiteExperiences,
    createSiteExperience,
    updateSiteExperience,
    deleteSiteExperience,

    // 扩展工具
    updateExtensions,

    // 隐身工具
    injectStealth,
    listStealthFeatures,
    listStealthPresets,
    setUserAgent,

    // 分析工具
    deobfuscateCode,
    understandCode,
    summarizeCode,
    detectCrypto,
    recordReverseEvidence,
    analyzeTarget,
    riskPanel,
    exportSessionReport,

    // 代码收集工具
    collectCode,
    collectionDiff,
    searchInScripts,

    // 重建工具
    exportRebuildBundle,
    diffEnvRequirements,

    // 反调试工具
    antiAntiDebug,
    bypassDebugger,

    // 加密库 Hook 工具
    hookCryptoJS,
    hookJSEncrypt,
    hookSMCrypto,

    // Vue 工具
    activateVueDevtools,
    clearVueGuards,
    getVueRoutes,

    // Session 工具
    saveSessionState,
    restoreSessionState,
    listSessionStates,
    deleteSessionState,
    dumpSessionState,
    loadSessionState,
    checkBrowserHealth,

    // Hook 工具 (AntiDebug_Breaker 迁移)
    hookConsoleLog,
    hookConsoleTable,
    hookLocationHref,
    hookCookie,
    hookXhrOpen,
    hookXhrSetRequestHeader,
    hookFetch,
    hookJsonParse,
    hookJsonStringify,
    hookPromise,
    hookRandom,
    hookLocalStorage,
    hookSessionStorage,
    antiAntiHook,
    hookWebSocket,
    hookHistory,

    // Hook 工具 (剩余 4 个 AntiDebug_Breaker 迁移)
    hookPerformanceNow,
    hookDateNow,
    fixedWindowSize,
    hookConsoleProtect,

    // Hook 工具 (新增 AntiDebug_Breaker 迁移)
    hookClose,
    hookConsoleClear,
    hookHistoryGo,

    // v_jstools 迁移工具
    deobfuscateCodeVJ,
    minifyCode,
    transpileCode,
    analyzeAst,
    diffCode,

    // v_jstools 代码模板
    getCodeTemplate,
    listCodeTemplates,
  ]);
}

/**
 * 获取工具注册表实例
 */
export function getToolRegistry(): ToolRegistry {
  return registry;
}

/**
 * 获取所有已注册的工具列表
 */
export function listTools(): JSHookToolDefinition[] {
  return registry.values();
}

// Auto-register on module load so tools are always available
registerBuiltInTools();
registry.autoGenerateKebabAliases();
