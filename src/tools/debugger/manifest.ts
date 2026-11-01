/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'debugger',
  description: 'Debugger protocol inspection and breakpoint tools.',
  profile: 'full',
  prerequisites: {
    setBreakpoint: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
      {
        condition: 'requiresDebugger',
        fix: 'Ensure debugger context is available.',
      },
    ],
    listScripts: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
      {
        condition: 'requiresDebugger',
        fix: 'Ensure debugger context is available.',
      },
    ],
    traceFunction: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
      {
        condition: 'requiresDebugger',
        fix: 'Ensure debugger context is available.',
      },
    ],
  },
  tools: [
    {modulePath: './debugger/index.js', handlerName: 'setBreakpoint'},
    {modulePath: './debugger/index.js', handlerName: 'removeBreakpoint'},
    {modulePath: './debugger/index.js', handlerName: 'listBreakpoints'},
    {modulePath: './debugger/index.js', handlerName: 'stepInto'},
    {modulePath: './debugger/index.js', handlerName: 'stepOver'},
    {modulePath: './debugger/index.js', handlerName: 'stepOut'},
    {
      modulePath: './debugger/index.js',
      handlerName: 'resume',
      requirements: {
        browser: 'connected',
        page: 'selected',
        debugger: 'available',
        recovery: true,
      },
    },
    {modulePath: './debugger/index.js', handlerName: 'pause'},
    {
      modulePath: './debugger/index.js',
      handlerName: 'listScripts',
      requirements: {
        browser: 'connected',
        page: 'selected',
        debugger: 'available',
      },
    },
    {modulePath: './debugger/index.js', handlerName: 'getScriptSource'},
    {modulePath: './debugger/index.js', handlerName: 'searchInSources'},
    {modulePath: './debugger/getStorage.js', handlerName: 'getStorage'},
    {modulePath: './debugger/index.js', handlerName: 'breakOnXhr'},
    {modulePath: './debugger/index.js', handlerName: 'removeXhrBreakpoint'},
    {modulePath: './debugger/monitorEvents.js', handlerName: 'monitorEvents'},
    {modulePath: './debugger/stopMonitor.js', handlerName: 'stopMonitor'},
    {modulePath: './debugger/index.js', handlerName: 'traceFunction'},
    {modulePath: './debugger/inspectObject.js', handlerName: 'inspectObject'},
    {modulePath: './debugger/listHooks.js', handlerName: 'listHooks'},
    {modulePath: './debugger/index.js', handlerName: 'findInScript'},
    {modulePath: './debugger/index.js', handlerName: 'getRequestInitiator'},
    {modulePath: './debugger/index.js', handlerName: 'getPausedInfo'},
    {
      modulePath: './debugger/index.js',
      handlerName: 'evaluateOnCallframe',
      requirements: {
        browser: 'connected',
        page: 'selected',
        debugger: 'paused',
      },
    },
    {modulePath: './debugger/index.js', handlerName: 'inspectLocals'},
    {modulePath: './debugger/index.js', handlerName: 'setBreakpointOnText'},
    {modulePath: './debugger/hookFunction.js', handlerName: 'hookFunction'},
    {modulePath: './debugger/unhookFunction.js', handlerName: 'unhookFunction'},
  ],
} satisfies DomainManifest;
