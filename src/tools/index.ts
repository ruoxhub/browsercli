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
import {
  cdp_start_proxy as startCdpProxy,
  cdp_get_targets,
  cdp_new_page,
  cdp_close_page,
  cdp_navigate,
  cdp_eval,
  cdp_click,
  cdp_click_at,
  cdp_screenshot,
  cdp_scroll,
  cdp_upload_files,
  cdp_page_info,
} from './cdp-proxy.js';
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
} from './debugger.js';
import {handleDialog} from './dialog.js';
import {queryDom, getDomStructure, findClickableElements} from './dom.js';
import {
  emulateMobile,
  emulateNetwork,
  emulateCpu,
  resizePage,
} from './emulation.js';
import {click, pressKey, fillForm, uploadFile, hover, drag} from './input.js';
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
import {listPages, selectPage, newPage} from './pages.js';
import {screenshot, captureVideoFrame} from './screenshot.js';
import {
  startPerformanceTrace,
  stopPerformanceTrace,
  getPerformanceMetrics,
  performanceAnalyzeInsight,
} from './performance.js';
import {createHook, injectHook, getHookData, removeHook} from './hook.js';
import {listFrames, selectFrame} from './frames.js';
import {evaluateScript, injectPreloadScript} from './script.js';
import {
  searchSiteExperience,
  listSiteExperiences,
  createSiteExperience,
  updateSiteExperience,
  deleteSiteExperience,
} from './siteExperience.js';
import {updateExtensions} from './extensions.js';
import {invokeSkill, listSkills} from './skill.js';
import {
  injectStealth,
  listStealthFeatures,
  listStealthPresets,
  setUserAgent,
} from './stealth.js';
import {exportRebuildBundle, diffEnvRequirements} from './rebuild.js';

// 反调试工具

// 加密库 Hook 工具

// Vue 工具
import type {JSHookToolDefinition} from './ToolRegistry.js';
import {ToolRegistry} from './ToolRegistry.js';
import {activateVueDevtools} from './vue/activateVueDevtools.js';
import {clearVueGuards} from './vue/clearVueGuards.js';
import {getVueRoutes} from './vue/getVueRoutes.js';

// CDP 代理
import {listNetworkRequests, getNetworkRequest} from './network.js';
import {
  listWebSocketConnections,
  getWebSocketMessages,
  analyzeWebSocketMessages,
} from './websocket.js';

const registry = new ToolRegistry();

/**
 * 注册所有内置工具
 */
export function registerBuiltInTools(): void {
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
    analyzeWebSocketMessages,

    // 输入工具
    click,
    pressKey,
    fillForm,
    uploadFile,
    hover,
    drag,

    // 导航工具
    clickElement,
    typeText,
    waitForElement,
    scrollBy,

    // 页面工具
    listPages,
    selectPage,
    newPage,

    // 截图工具
    screenshot,
    captureVideoFrame,

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

    // Hook 工具
    createHook,
    injectHook,
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

    // CDP 代理工具
    startCdpProxy,
    cdp_get_targets,
    cdp_new_page,
    cdp_close_page,
    cdp_navigate,
    cdp_eval,
    cdp_click,
    cdp_click_at,
    cdp_screenshot,
    cdp_scroll,
    cdp_upload_files,
    cdp_page_info,

    // Session 工具
    saveSessionState,
    restoreSessionState,
    listSessionStates,
    deleteSessionState,
    dumpSessionState,
    loadSessionState,
    checkBrowserHealth,
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
