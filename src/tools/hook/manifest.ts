/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'hook',
  description: 'JavaScript runtime hook creation and management tools.',
  prerequisites: {
    injectHook: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
    hookCookie: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
    hookFetch: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
  },
  toolDependencies: [
    {from: 'injectHook', to: 'createHook', relation: 'requires', weight: 1},
    {from: 'hookCookie', to: 'injectHook', relation: 'uses', weight: 0.8},
    {from: 'hookFetch', to: 'injectHook', relation: 'uses', weight: 0.8},
  ],
  sceneKeywords: {
    hookCookie: ['cookie', 'document.cookie', 'runtime hook'],
    hookFetch: ['fetch', 'request', 'network hook'],
    injectHook: ['inject', 'runtime', 'instrumentation'],
  },
  tools: [
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
    {modulePath: './hook/SessionStorage.js', handlerName: 'hookSessionStorage'},
    {modulePath: './hook/DateNow.js', handlerName: 'hookDateNow'},
    {modulePath: './hook/PerformanceNow.js', handlerName: 'hookPerformanceNow'},
    {modulePath: './hook/Random.js', handlerName: 'hookRandom'},
    {modulePath: './hook/Promise.js', handlerName: 'hookPromise'},
    {modulePath: './hook/History.js', handlerName: 'hookHistory'},
    {modulePath: './hook/HistoryGo.js', handlerName: 'hookHistoryGo'},
    {modulePath: './hook/LocationHref.js', handlerName: 'hookLocationHref'},
    {modulePath: './hook/Close.js', handlerName: 'hookClose'},
    {modulePath: './hook/ConsoleLog.js', handlerName: 'hookConsoleLog'},
    {modulePath: './hook/ConsoleClear.js', handlerName: 'hookConsoleClear'},
    {modulePath: './hook/ConsoleProtect.js', handlerName: 'hookConsoleProtect'},
    {modulePath: './hook/ConsoleTable.js', handlerName: 'hookConsoleTable'},
    {modulePath: './hook/fixedWindowSize.js', handlerName: 'fixedWindowSize'},
    {modulePath: './hook/antiAntiHook.js', handlerName: 'antiAntiHook'},
  ],
} satisfies DomainManifest;
