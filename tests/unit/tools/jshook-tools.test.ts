/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {zod} from '../../../src/third_party/index.js';
import {
  analyzeTarget,
  riskPanel,
  summarizeCode,
  exportSessionReport,
} from '../../../src/tools/analyzer.js';
import {collectCode, collectionDiff} from '../../../src/tools/collector.js';
import {queryDom} from '../../../src/tools/dom.js';
import {
  createHook,
  getHookData,
  listCreatedHooks,
  removeHook,
} from '../../../src/tools/hook.js';
import {hookConsoleLog} from '../../../src/tools/hook/hookConsoleLog.js';
import {hookConsoleTable} from '../../../src/tools/hook/hookConsoleTable.js';
import {hookLocationHref} from '../../../src/tools/hook/hookLocationHref.js';
import {hookCookie} from '../../../src/tools/hook/hookCookie.js';
import {hookXhrOpen} from '../../../src/tools/hook/hookXhrOpen.js';
import {hookXhrSetRequestHeader} from '../../../src/tools/hook/hookXhrSetRequestHeader.js';
import {hookFetch} from '../../../src/tools/hook/hookFetch.js';
import {hookJsonParse} from '../../../src/tools/hook/hookJsonParse.js';
import {hookJsonStringify} from '../../../src/tools/hook/hookJsonStringify.js';
import {hookPromise} from '../../../src/tools/hook/hookPromise.js';
import {hookRandom} from '../../../src/tools/hook/hookRandom.js';
import {hookLocalStorage} from '../../../src/tools/hook/hookLocalStorage.js';
import {hookSessionStorage} from '../../../src/tools/hook/hookSessionStorage.js';
import {antiAntiHook} from '../../../src/tools/hook/antiAntiHook.js';
import {hookWebSocket} from '../../../src/tools/hook/hookWebSocket.js';
import {hookHistory} from '../../../src/tools/hook/hookHistory.js';
import {hookPerformanceNow} from '../../../src/tools/hook/hookPerformanceNow.js';
import {hookDateNow} from '../../../src/tools/hook/hookDateNow.js';
import {fixedWindowSize} from '../../../src/tools/hook/fixedWindowSize.js';
import {hookConsoleProtect} from '../../../src/tools/hook/hookConsoleProtect.js';
import {clearVueGuards} from '../../../src/tools/vue/clearVueGuards.js';
import {getVueRoutes} from '../../../src/tools/vue/getVueRoutes.js';
import {activateVueDevtools} from '../../../src/tools/vue/activateVueDevtools.js';
import {
  clickElement,
  checkBrowserHealth,
  deleteSessionState,
  dumpSessionState,
  listSessionStates,
  loadSessionState,
  restoreSessionState,
  saveSessionState,
} from '../../../src/tools/page.js';
import {injectStealth} from '../../../src/tools/stealth.js';

describe('jshook tools schema', () => {
  it('validates collect_code schema', () => {
    const schema = zod.object(collectCode.schema);
    const result = schema.parse({
      url: 'https://example.com',
      smartMode: 'summary',
      returnMode: 'pattern',
      pattern: 'main',
      limit: 5,
      topN: 3,
    });
    assert.strictEqual(result.smartMode, 'summary');
    assert.strictEqual(result.returnMode, 'pattern');
  });

  it('validates collection_diff schema', () => {
    const schema = zod.object(collectionDiff.schema);
    const result = schema.parse({
      previous: [{url: 'a.js', size: 12, type: 'external'}],
      includeUnchanged: true,
    });
    assert.strictEqual(result.previous.length, 1);
    assert.strictEqual(result.includeUnchanged, true);
  });

  it('validates summarize_code schema', () => {
    const schema = zod.object(summarizeCode.schema);
    const result = schema.parse({mode: 'single', code: 'const x = 1;'});
    assert.strictEqual(result.mode, 'single');
  });

  it('validates risk_panel and export_session_report schemas', () => {
    const riskSchema = zod.object(riskPanel.schema);
    const analyzeSchema = zod.object(analyzeTarget.schema);
    const reportSchema = zod.object(exportSessionReport.schema);

    const risk = riskSchema.parse({code: 'md5(x)', includeHookSignals: true});
    const workflow = analyzeSchema.parse({
      url: 'https://example.com',
      hookPreset: 'network-core',
      autoInjectHooks: true,
      correlationWindowMs: 800,
      maxCorrelatedFlows: 5,
      maxFingerprints: 6,
    });
    const report = reportSchema.parse({
      format: 'markdown',
      includeHookData: true,
    });

    assert.strictEqual(risk.includeHookSignals, true);
    assert.strictEqual(workflow.hookPreset, 'network-core');
    assert.strictEqual(workflow.maxFingerprints, 6);
    assert.strictEqual(report.format, 'markdown');
  });

  it('validates hook and stealth schemas', () => {
    const hookSchema = zod.object(createHook.schema);
    const hookDataSchema = zod.object(getHookData.schema);
    const listHooksSchema = zod.object(listCreatedHooks.schema);
    const removeHookSchema = zod.object(removeHook.schema);
    const stealthSchema = zod.object(injectStealth.schema);

    const hook = hookSchema.parse({type: 'fetch'});
    const hookData = hookDataSchema.parse({
      hookId: 'h1',
      view: 'summary',
      maxRecords: 20,
    });
    const listHooks = listHooksSchema.parse({});
    const removeHookResult = removeHookSchema.parse({hookId: 'fetch-123'});
    const stealth = stealthSchema.parse({preset: 'windows-chrome'});

    assert.strictEqual(hook.type, 'fetch');
    assert.strictEqual(hookData.view, 'summary');
    assert.strictEqual(listHooks.verbose, undefined);
    assert.strictEqual(removeHookResult.hookId, 'fetch-123');
    assert.strictEqual(stealth.preset, 'windows-chrome');
  });

  it('validates dom and page schemas', () => {
    const domSchema = zod.object(queryDom.schema);
    const pageSchema = zod.object(clickElement.schema);
    const healthSchema = zod.object(checkBrowserHealth.schema);
    const saveSessionSchema = zod.object(saveSessionState.schema);
    const restoreSessionSchema = zod.object(restoreSessionState.schema);
    const listSessionSchema = zod.object(listSessionStates.schema);
    const deleteSessionSchema = zod.object(deleteSessionState.schema);
    const dumpSessionSchema = zod.object(dumpSessionState.schema);
    const loadSessionSchema = zod.object(loadSessionState.schema);

    const dom = domSchema.parse({selector: 'button'});
    const page = pageSchema.parse({selector: '#x'});
    const health = healthSchema.parse({});
    const saveSession = saveSessionSchema.parse({
      sessionId: 's1',
      includeCookies: true,
    });
    const restoreSession = restoreSessionSchema.parse({
      sessionId: 's1',
      clearStorageBeforeRestore: true,
    });
    const listed = listSessionSchema.parse({});
    const removed = deleteSessionSchema.parse({sessionId: 's1'});
    const dumped = dumpSessionSchema.parse({sessionId: 's1', pretty: false});
    const loaded = loadSessionSchema.parse({
      snapshotJson: '{"id":"s1"}',
      overwrite: true,
    });

    assert.strictEqual(dom.selector, 'button');
    assert.strictEqual(page.selector, '#x');
    assert.deepStrictEqual(health, {});
    assert.strictEqual(saveSession.sessionId, 's1');
    assert.strictEqual(restoreSession.clearStorageBeforeRestore, true);
    assert.deepStrictEqual(listed, {});
    assert.strictEqual(removed.sessionId, 's1');
    assert.strictEqual(dumped.pretty, false);
    assert.strictEqual(loaded.overwrite, true);
  });

  it('validates all AntiDebug_Breaker migration hook schemas', () => {
    // hook_console_log
    const consoleLogSchema = zod.object(hookConsoleLog.schema);
    const consoleLogDefault = consoleLogSchema.parse({});
    assert.strictEqual(consoleLogDefault.mode, 'proxy');
    const consoleLogToString = consoleLogSchema.parse({mode: 'toString'});
    assert.strictEqual(consoleLogToString.mode, 'toString');
    const consoleLogFreeze = consoleLogSchema.parse({mode: 'freeze'});
    assert.strictEqual(consoleLogFreeze.mode, 'freeze');

    // hook_console_table
    const consoleTableSchema = zod.object(hookConsoleTable.schema);
    const consoleTableDefault = consoleTableSchema.parse({});
    assert.strictEqual(consoleTableDefault.enabled, true);
    const consoleTableDisabled = consoleTableSchema.parse({enabled: false});
    assert.strictEqual(consoleTableDisabled.enabled, false);

    // hook_location_href
    const locationHrefSchema = zod.object(hookLocationHref.schema);
    const locationHrefDefault = locationHrefSchema.parse({});
    assert.strictEqual(locationHrefDefault.triggerDebugger, true);
    const locationHrefNoDebug = locationHrefSchema.parse({
      triggerDebugger: false,
    });
    assert.strictEqual(locationHrefNoDebug.triggerDebugger, false);

    // hook_cookie
    const cookieSchema = zod.object(hookCookie.schema);
    const cookieDefault = cookieSchema.parse({});
    assert.strictEqual(cookieDefault.showStack, false);
    assert.strictEqual(cookieDefault.triggerDebugger, false);
    assert.deepStrictEqual(cookieDefault.filterKeys, undefined);
    const cookieFiltered = cookieSchema.parse({
      filterKeys: ['token', 'session'],
      showStack: true,
    });
    assert.deepStrictEqual(cookieFiltered.filterKeys, ['token', 'session']);
    assert.strictEqual(cookieFiltered.showStack, true);

    // hook_xhr_open
    const xhrOpenSchema = zod.object(hookXhrOpen.schema);
    const xhrOpenDefault = xhrOpenSchema.parse({});
    assert.strictEqual(xhrOpenDefault.showStack, false);
    assert.strictEqual(xhrOpenDefault.triggerDebugger, false);
    assert.deepStrictEqual(xhrOpenDefault.filterUrls, undefined);
    const xhrOpenFiltered = xhrOpenSchema.parse({
      filterUrls: ['/api'],
      triggerDebugger: true,
    });
    assert.deepStrictEqual(xhrOpenFiltered.filterUrls, ['/api']);
    assert.strictEqual(xhrOpenFiltered.triggerDebugger, true);

    // hook_xhr_set_request_header
    const xhrHeaderSchema = zod.object(hookXhrSetRequestHeader.schema);
    const xhrHeaderDefault = xhrHeaderSchema.parse({});
    assert.strictEqual(xhrHeaderDefault.showStack, false);
    assert.strictEqual(xhrHeaderDefault.triggerDebugger, false);
    const xhrHeaderFiltered = xhrHeaderSchema.parse({
      filterKeys: ['Authorization'],
      showStack: true,
    });
    assert.deepStrictEqual(xhrHeaderFiltered.filterKeys, ['Authorization']);
    assert.strictEqual(xhrHeaderFiltered.showStack, true);

    // hook_fetch
    const fetchSchema = zod.object(hookFetch.schema);
    const fetchDefault = fetchSchema.parse({});
    assert.strictEqual(fetchDefault.showStack, false);
    assert.strictEqual(fetchDefault.triggerDebugger, false);

    // hook_json_parse
    const jsonParseSchema = zod.object(hookJsonParse.schema);
    const jsonParseDefault = jsonParseSchema.parse({});
    assert.strictEqual(jsonParseDefault.showStack, false);
    assert.strictEqual(jsonParseDefault.triggerDebugger, false);
    const jsonParseFiltered = jsonParseSchema.parse({
      filterKeys: ['secret'],
      triggerDebugger: true,
    });
    assert.deepStrictEqual(jsonParseFiltered.filterKeys, ['secret']);

    // hook_json_stringify
    const jsonStringifySchema = zod.object(hookJsonStringify.schema);
    const jsonStringifyDefault = jsonStringifySchema.parse({});
    assert.strictEqual(jsonStringifyDefault.showStack, false);
    assert.strictEqual(jsonStringifyDefault.triggerDebugger, false);

    // hook_promise
    const promiseSchema = zod.object(hookPromise.schema);
    const promiseDefault = promiseSchema.parse({});
    assert.strictEqual(promiseDefault.showStack, false);
    assert.strictEqual(promiseDefault.triggerDebugger, false);

    // hook_random
    const randomSchema = zod.object(hookRandom.schema);
    const randomDefault = randomSchema.parse({});
    assert.strictEqual(randomDefault.fixedValue, 0);
    assert.strictEqual(randomDefault.showStack, false);
    const randomCustom = randomSchema.parse({
      fixedValue: 0.5,
      triggerDebugger: true,
    });
    assert.strictEqual(randomCustom.fixedValue, 0.5);
    assert.strictEqual(randomCustom.triggerDebugger, true);

    // hook_local_storage
    const lsSchema = zod.object(hookLocalStorage.schema);
    const lsDefault = lsSchema.parse({});
    assert.deepStrictEqual(lsDefault.actions, undefined);
    assert.strictEqual(lsDefault.showStack, false);
    assert.strictEqual(lsDefault.triggerDebugger, false);
    const lsFiltered = lsSchema.parse({
      actions: ['setItem', 'getItem'],
      filterKeys: ['user'],
      showStack: true,
    });
    assert.deepStrictEqual(lsFiltered.actions, ['setItem', 'getItem']);
    assert.deepStrictEqual(lsFiltered.filterKeys, ['user']);

    // hook_session_storage
    const ssSchema = zod.object(hookSessionStorage.schema);
    const ssDefault = ssSchema.parse({});
    assert.deepStrictEqual(ssDefault.actions, undefined);
    assert.strictEqual(ssDefault.showStack, false);
    assert.strictEqual(ssDefault.triggerDebugger, false);
    const ssFiltered = ssSchema.parse({
      actions: ['removeItem', 'clear'],
      filterKeys: ['temp'],
      triggerDebugger: true,
    });
    assert.deepStrictEqual(ssFiltered.actions, ['removeItem', 'clear']);
    assert.deepStrictEqual(ssFiltered.filterKeys, ['temp']);

    // anti_anti_hook
    const antiAntiSchema = zod.object(antiAntiHook.schema);
    const antiAntiDefault = antiAntiSchema.parse({});
    assert.deepStrictEqual(antiAntiDefault.hookedMethods, undefined);
    const antiAntiMethods = antiAntiSchema.parse({
      hookedMethods: ['console.table', 'localStorage.setItem'],
    });
    assert.deepStrictEqual(antiAntiMethods.hookedMethods, [
      'console.table',
      'localStorage.setItem',
    ]);

    // hook_websocket
    const wsSchema = zod.object(hookWebSocket.schema);
    const wsDefault = wsSchema.parse({});
    assert.strictEqual(wsDefault.showStack, false);
    assert.strictEqual(wsDefault.triggerDebugger, false);
    assert.deepStrictEqual(wsDefault.filterUrls, undefined);
    const wsFiltered = wsSchema.parse({
      filterUrls: ['wss://api.example.com'],
      showStack: true,
    });
    assert.deepStrictEqual(wsFiltered.filterUrls, ['wss://api.example.com']);
    assert.strictEqual(wsFiltered.showStack, true);

    // hook_history
    const historySchema = zod.object(hookHistory.schema);
    const historyDefault = historySchema.parse({});
    assert.strictEqual(historyDefault.showStack, false);
    assert.strictEqual(historyDefault.triggerDebugger, false);
    assert.deepStrictEqual(historyDefault.filterUrls, undefined);
    const historyFiltered = historySchema.parse({
      filterUrls: ['/dashboard'],
      triggerDebugger: true,
    });
    assert.deepStrictEqual(historyFiltered.filterUrls, ['/dashboard']);
    assert.strictEqual(historyFiltered.triggerDebugger, true);

    // hook_performance_now
    const perfSchema_ = zod.object(hookPerformanceNow.schema);
    const perfDefault = perfSchema_.parse({});
    assert.strictEqual(perfDefault.fixedValue, 0);
    assert.strictEqual(perfDefault.showStack, false);
    assert.strictEqual(perfDefault.triggerDebugger, false);
    const perfCustom = perfSchema_.parse({
      fixedValue: 123.45,
      triggerDebugger: true,
    });
    assert.strictEqual(perfCustom.fixedValue, 123.45);
    assert.strictEqual(perfCustom.triggerDebugger, true);

    // hook_date_now
    const dateSchema = zod.object(hookDateNow.schema);
    const dateDefault = dateSchema.parse({});
    assert.strictEqual(dateDefault.fixedValue, 0);
    assert.strictEqual(dateDefault.showStack, false);
    const dateCustom = dateSchema.parse({
      fixedValue: 1700000000000,
      showStack: true,
    });
    assert.strictEqual(dateCustom.fixedValue, 1700000000000);
    assert.strictEqual(dateCustom.showStack, true);

    // fixed_window_size
    const winSchema = zod.object(fixedWindowSize.schema);
    const winDefault = winSchema.parse({});
    assert.strictEqual(winDefault.innerHeight, 660);
    assert.strictEqual(winDefault.innerWidth, 1366);
    assert.strictEqual(winDefault.outerHeight, 760);
    assert.strictEqual(winDefault.outerWidth, 1400);
    const winCustom = winSchema.parse({
      innerHeight: 900,
      innerWidth: 1440,
    });
    assert.strictEqual(winCustom.innerHeight, 900);
    assert.strictEqual(winCustom.innerWidth, 1440);

    // hook_console_protect
    const protectSchema = zod.object(hookConsoleProtect.schema);
    const protectDefault = protectSchema.parse({});
    assert.deepStrictEqual(protectDefault.protectedMethods, [
      'log',
      'trace',
      'groupCollapsed',
      'groupEnd',
    ]);
    const protectCustom = protectSchema.parse({
      protectedMethods: ['log', 'warn'],
    });
    assert.deepStrictEqual(protectCustom.protectedMethods, ['log', 'warn']);
  });

  it('validates Vue tools schemas', () => {
    // clear_vue_guards
    const clearGuardsSchema = zod.object(clearVueGuards.schema);
    const clearGuardsDefault = clearGuardsSchema.parse({});
    assert.deepStrictEqual(clearGuardsDefault.guards, undefined);
    const clearGuardsSpecific = clearGuardsSchema.parse({
      guards: ['beforeEach', 'afterEach'],
    });
    assert.deepStrictEqual(clearGuardsSpecific.guards, [
      'beforeEach',
      'afterEach',
    ]);
    const clearGuardsAll = clearGuardsSchema.parse({guards: ['all']});
    assert.deepStrictEqual(clearGuardsAll.guards, ['all']);

    // get_vue_routes
    const routesSchema = zod.object(getVueRoutes.schema);
    const routesDefault = routesSchema.parse({});
    assert.strictEqual(routesDefault.includeChildren, true);
    assert.strictEqual(routesDefault.maxDepth, 3);
    const routesCustom = routesSchema.parse({
      includeChildren: false,
      maxDepth: 5,
    });
    assert.strictEqual(routesCustom.includeChildren, false);
    assert.strictEqual(routesCustom.maxDepth, 5);

    // activate_vue_devtools
    const vueDevtoolsSchema = zod.object(activateVueDevtools.schema);
    const vueDevtoolsDefault = vueDevtoolsSchema.parse({});
    assert.deepStrictEqual(vueDevtoolsDefault, {});
  });
});
