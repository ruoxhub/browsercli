/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {StealthScripts2025} from '../../../src/modules/stealth/StealthScripts2025.js';
import {getRuntime} from '../../../src/runtime.js';
import {
  collectCode,
  collectionDiff,
  searchInScripts,
} from '../../../src/tools/collector/index.js';
import {
  findClickableElements,
  getDomStructure,
  queryDom,
} from '../../../src/tools/dom/index.js';
import {
  createHook,
  getHookData,
  injectHook,
  removeHook,
} from '../../../src/tools/hook/index.js';
import {click} from '../../../src/tools/input/click.js';
import {
  checkBrowserHealth,
  deleteSessionState,
  dumpSessionState,
  listSessionStates,
  loadSessionState,
  restoreSessionState,
  saveSessionState,
  waitForElement,
} from '../../../src/tools/page/index.js';
import {getPerformanceMetrics} from '../../../src/tools/performance/index.js';
import {
  injectStealth,
  listStealthFeatures,
  listStealthPresets,
  setUserAgent,
} from '../../../src/tools/stealth/index.js';
import {ToolError} from '../../../src/utils/errors.js';

type RuntimeMethod = (...args: unknown[]) => unknown;

interface ToolResponseHarness {
  lines: string[];
  appendResponseLine(value: string): void;
  setIncludePages(): void;
  setIncludeNetworkRequests(): void;
  setIncludeConsoleData(): void;
  attachImage(): void;
  attachNetworkRequest(): void;
  attachConsoleMessage(): void;
  setIncludeWebSocketConnections(): void;
  attachWebSocket(): void;
  setStructuredContent(): void;
}

interface ToolDefinitionHarness {
  handler(
    request: {params: unknown},
    response: ToolResponseHarness,
    context: object,
    runtime: RuntimeHarness,
  ): Promise<void>;
}

interface RuntimeHarness {
  collector: {
    collect: RuntimeMethod;
    getFilesByPattern: RuntimeMethod;
    getCollectedFilesSummary: RuntimeMethod;
    getTopPriorityFiles: RuntimeMethod;
    getActivePage: RuntimeMethod;
    getStatus: RuntimeMethod;
  };
  domInspector: {
    querySelector: RuntimeMethod;
    querySelectorAll: RuntimeMethod;
    getStructure: RuntimeMethod;
    findClickable: RuntimeMethod;
  };
  hookManager: {
    create: RuntimeMethod;
    getHook: RuntimeMethod;
    getAllHooks: RuntimeMethod;
    getRecords: RuntimeMethod;
    exportData: RuntimeMethod;
    getStats: RuntimeMethod;
    remove: RuntimeMethod;
  };
  pageController: {
    injectScript: RuntimeMethod;
    navigate: RuntimeMethod;
    click: RuntimeMethod;
    type: RuntimeMethod;
    waitForSelector: RuntimeMethod;
    screenshot: RuntimeMethod;
    getPerformanceMetrics: RuntimeMethod;
    getPage: RuntimeMethod;
    getCookies: RuntimeMethod;
    getLocalStorage: RuntimeMethod;
    getSessionStorage: RuntimeMethod;
    clearCookies: RuntimeMethod;
    clearLocalStorage: RuntimeMethod;
    clearSessionStorage: RuntimeMethod;
    setCookies: RuntimeMethod;
    setLocalStorage: RuntimeMethod;
    setSessionStorage: RuntimeMethod;
    replayActions: RuntimeMethod;
    evaluate: RuntimeMethod;
  };
  browserManager: {
    getBrowser: RuntimeMethod;
  };
}

interface StealthStaticHarness {
  injectAll: RuntimeMethod;
  getPresets: RuntimeMethod;
}

const createMockLocator = () => ({
  first: () => ({
    evaluate: async (_fn: unknown) => ({
      found: true,
      nodeName: 'DIV',
      attributes: {},
      textContent: 'DIV content',
      boundingBox: {x: 0, y: 0, width: 10, height: 10},
      visible: true,
      tagName: 'div',
    }),
    click: async () => undefined,
    fill: async () => undefined,
  }),
  count: async () => 1,
  evaluate: async (_fn: unknown) => ({
    found: true,
    nodeName: 'DIV',
    tagName: 'div',
  }),
  evaluateAll: async (_fn: unknown) => [{found: true, nodeName: 'SPAN'}],
  click: async () => undefined,
  hover: async () => undefined,
  fill: async () => undefined,
  selectOption: async () => undefined,
  pressSequentially: async () => undefined,
  waitFor: async () => undefined,
  boundingBox: async () => ({x: 10, y: 10, width: 100, height: 100}),
  setInputFiles: async () => undefined,
});

const defaultMockPage = {
  locator: () => createMockLocator(),
  mainFrame: () => mockFrame,
  setUserAgent: async () => undefined,
  url: () => 'https://example.com/dashboard',
  title: async () => 'Dashboard',
  goto: async () => undefined,
  click: async () => undefined,
  type: async () => undefined,
  waitForSelector: async () => ({}),
  isClosed: () => false,
  context: () => ({
    cookies: async () => [],
    clearCookies: async () => undefined,
    addCookies: async () => undefined,
    newCDPSession: async () => ({
      send: async () => ({}),
      detach: async () => undefined,
    }),
  }),
  evaluate: async () => undefined,
  once: () => undefined,
  on: () => undefined,
  off: () => undefined,
  removeListener: () => undefined,
};

const mockFrame = {
  page: () => defaultMockPage,
  locator: () => createMockLocator(),
  evaluate: async (fnOrScript: unknown) => {
    if (typeof fnOrScript === 'function') {
      const fnStr = fnOrScript.toString();
      if (fnStr.includes('__hookStore')) {
        throw new Error('No in-page hook store');
      }
      return {
        found: true,
        nodeName: 'DIV',
        elements: [{found: true, nodeName: 'SPAN'}],
      };
    }
    if (typeof fnOrScript === 'string' && fnOrScript.includes('__hookStore')) {
      throw new Error('No in-page hook store');
    }
    return {
      found: true,
      nodeName: 'DIV',
      elements: [{found: true, nodeName: 'SPAN'}],
    };
  },
};

const defaultTestContext = {
  getSelectedFrame: () => mockFrame,
  getSelectedPage: () => defaultMockPage,
};

const invokeTool = async (
  tool: ToolDefinitionHarness,
  params: Record<string, unknown>,
  response: ToolResponseHarness,
  runtime: RuntimeHarness,
  context: object = defaultTestContext,
): Promise<void> => {
  await tool.handler({params}, response, context, runtime);
};

function makeResponse(): ToolResponseHarness {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: () => undefined,
    setIncludeNetworkRequests: () => undefined,
    setIncludeConsoleData: () => undefined,
    attachImage: () => undefined,
    attachNetworkRequest: () => undefined,
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
    setStructuredContent: (payload?: unknown) => {
      if (payload !== undefined) {
        lines.push(JSON.stringify(payload));
      }
    },
  };
}

describe('jshook tools handlers', () => {
  it('covers collector/dom/hook/page/stealth handlers', async () => {
    const runtime = getRuntime() as unknown as RuntimeHarness;
    const stealth = StealthScripts2025 as unknown as StealthStaticHarness;

    const originals = {
      collect: runtime.collector.collect,
      getFilesByPattern: runtime.collector.getFilesByPattern,
      getCollectedFilesSummary: runtime.collector.getCollectedFilesSummary,
      getTopPriorityFiles: runtime.collector.getTopPriorityFiles,
      querySelector: runtime.domInspector.querySelector,
      querySelectorAll: runtime.domInspector.querySelectorAll,
      getStructure: runtime.domInspector.getStructure,
      findClickable: runtime.domInspector.findClickable,
      createHook: runtime.hookManager.create,
      getHook: runtime.hookManager.getHook,
      getAllHooks: runtime.hookManager.getAllHooks,
      getRecords: runtime.hookManager.getRecords,
      exportData: runtime.hookManager.exportData,
      getStats: runtime.hookManager.getStats,
      removeHook: runtime.hookManager.remove,
      injectScript: runtime.pageController.injectScript,
      navigate: runtime.pageController.navigate,
      click: runtime.pageController.click,
      type: runtime.pageController.type,
      waitForSelector: runtime.pageController.waitForSelector,
      screenshot: runtime.pageController.screenshot,
      metrics: runtime.pageController.getPerformanceMetrics,
      getPage: runtime.pageController.getPage,
      getCookies: runtime.pageController.getCookies,
      getLocalStorage: runtime.pageController.getLocalStorage,
      getSessionStorage: runtime.pageController.getSessionStorage,
      clearCookies: runtime.pageController.clearCookies,
      clearLocalStorage: runtime.pageController.clearLocalStorage,
      clearSessionStorage: runtime.pageController.clearSessionStorage,
      setCookies: runtime.pageController.setCookies,
      setLocalStorage: runtime.pageController.setLocalStorage,
      setSessionStorage: runtime.pageController.setSessionStorage,
      replayActions: runtime.pageController.replayActions,
      evaluate: runtime.pageController.evaluate,
      getActivePage: runtime.collector.getActivePage,
      getStatus: runtime.collector.getStatus,
      getBrowser: runtime.browserManager.getBrowser,
      injectAll: stealth.injectAll,
      getPresets: stealth.getPresets,
    };

    runtime.collector.collect = async () => ({
      files: [
        {url: 'a.js', content: 'const a = 1;', size: 10, type: 'external'},
      ],
      totalSize: 10,
      collectTime: 1,
    });
    runtime.collector.getFilesByPattern = () => ({
      files: [
        {url: 'b.js', content: 'const b = 1;', size: 10, type: 'external'},
      ],
      totalSize: 10,
      matched: 1,
      returned: 1,
      truncated: false,
    });
    runtime.collector.getCollectedFilesSummary = () => [
      {url: 'b.js', size: 10, type: 'external'},
    ];
    runtime.collector.getTopPriorityFiles = () => ({
      files: [
        {
          url: 'top.js',
          content:
            'function signPayload(token, nonce){ return token + nonce; }\nfetch("/api/order/sign", {method:"POST"});',
          size: 120,
          type: 'external',
        },
      ],
      totalSize: 1,
      totalFiles: 1,
    });
    runtime.collector.getStatus = async () => ({
      running: true,
      pagesCount: 1,
      version: 'Chrome/145',
    });

    runtime.domInspector.querySelector = async () => ({
      found: true,
      nodeName: 'DIV',
    });
    runtime.domInspector.querySelectorAll = async () => [
      {found: true, nodeName: 'SPAN'},
    ];
    runtime.domInspector.getStructure = async () => ({tag: 'BODY'});
    runtime.domInspector.findClickable = async () => [
      {selector: '#x', text: 'x', type: 'button', visible: true},
    ];

    let hookCounter = 0;
    const baseTs = Date.now();
    runtime.hookManager.create = (({type}: {type: string}) => {
      hookCounter += 1;
      return {
        hookId: hookCounter === 1 ? 'h1' : `${type}-hook-${hookCounter}`,
        script: `/* ${type} hook */`,
      };
    }) as RuntimeMethod;
    runtime.hookManager.getHook = ((id: string) =>
      id === 'missing'
        ? undefined
        : {hookId: id, script: 'console.log(1)'}) as RuntimeMethod;
    runtime.hookManager.getAllHooks = () => [
      {hookId: 'h1'},
      {hookId: 'xhr-hook-2'},
      {hookId: 'websocket-hook-3'},
    ];
    runtime.hookManager.getRecords = ((hookId: string) => {
      if (hookId.includes('xhr')) {
        return [
          {
            id: 11,
            target: undefined,
            event: 'open',
            timestamp: undefined,
          },
        ];
      }
      if (hookId.includes('websocket')) {
        return [
          {
            id: 12,
            target: 'websocket',
            url: 'wss://api.example.com/ws/sign?nonce=1',
            event: 'send',
            data: '{"token":"ws-token"}',
            timestamp: baseTs + 150,
          },
        ];
      }
      return [
        {
          id: 1,
          target: 'fetch',
          url: 'https://api.example.com/sign/12345?nonce=1&token=abc',
          method: 'POST',
          body: '{"token":"abc","sign":"xyz"}',
          status: 200,
          timestamp: baseTs + 100,
        },
        {
          id: 2,
          target: 'fetch',
          url: 'https://api.example.com/sign/12345?nonce=1&token=abc',
          method: 'POST',
          requestBody: '{"auth":"yes"}',
          status: 201,
          timestamp: baseTs + 130,
        },
        {
          id: 22,
          target: 'fetch',
          url: 'https://api.example.com/sign/12345?nonce=1&token=abc',
          method: 'POST',
          requestBody: '{"auth":"yes"}',
          status: 201,
          timestamp: baseTs + 131,
        },
        {
          id: 3,
          target: 'fetch',
          url: 'https://api.example.com/sign/67890?nonce=2&token=def',
          method: 'POST',
          body: '{"token":"next"}',
          status: 403,
          timestamp: baseTs + 2500,
        },
        {
          id: 4,
          target: 'fetch',
          url: '/relative/sign/99999?token=abc',
          method: 'POST',
          data: '{"x-sign":"v"}',
          status: 200,
          timestamp: baseTs + 2600,
        },
      ];
    }) as RuntimeMethod;
    runtime.hookManager.getStats = () => ({
      totalHooks: 1,
      enabledHooks: 1,
      disabledHooks: 0,
      registeredTypes: ['fetch'],
      hooks: [
        {
          hookId: 'h1',
          type: 'fetch',
          description: 'd',
          enabled: true,
          callCount: 1,
        },
      ],
    });
    runtime.hookManager.remove = ((id: string) => id === 'h1') as RuntimeMethod;

    runtime.pageController.injectScript = async () => undefined;
    runtime.pageController.navigate = async () => ({
      ok: true,
      url: 'https://a.com',
    });
    runtime.pageController.click = async () => undefined;
    runtime.pageController.type = async () => undefined;
    runtime.pageController.waitForSelector = async () => ({found: true});
    runtime.pageController.screenshot = async () => Buffer.from('shot');
    runtime.pageController.getPerformanceMetrics = async () => ({fcp: 100});
    runtime.pageController.getCookies = async () => [{name: 'sid', value: '1'}];
    runtime.pageController.getLocalStorage = async () => ({token: 'abc'});
    runtime.pageController.getSessionStorage = async () => ({nonce: 'n'});
    runtime.pageController.clearCookies = async () => undefined;
    runtime.pageController.clearLocalStorage = async () => undefined;
    runtime.pageController.clearSessionStorage = async () => undefined;
    runtime.pageController.setCookies = async () => undefined;
    runtime.pageController.setLocalStorage = async () => undefined;
    runtime.pageController.setSessionStorage = async () => undefined;
    runtime.pageController.replayActions = (async (
      actions: Array<{action: string}>,
    ) =>
      actions.map((action, index) => ({
        index,
        action: action.action,
        success: true,
        message: 'ok',
      }))) as RuntimeMethod;
    runtime.pageController.evaluate = async () => 2;

    const activePage = {
      setUserAgent: async () => undefined,
      url: () => 'https://example.com/dashboard',
      title: async () => 'Dashboard',
      evaluate: async () => 2,
      isClosed: () => false,
      once: () => undefined,
      on: () => undefined,
      off: () => undefined,
      removeListener: () => undefined,
    };
    runtime.pageController.getPage = async () => activePage;
    runtime.collector.getActivePage = async () => activePage;

    stealth.injectAll = async () => undefined;
    stealth.getPresets = () => ({'windows-chrome': {preset: 'windows-chrome'}});

    try {
      const res = makeResponse();

      runtime.collector.getTopPriorityFiles = () => ({
        files: [{url: 'top.js', content: 'x', size: 1, type: 'external'}],
        totalSize: 1,
        totalFiles: 1,
      });

      runtime.collector.collect = async () => ({files: [{url: 'a.js'}]});
      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com'},
        res,
        runtime,
      );
      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com', returnMode: 'summary'},
        res,
        runtime,
      );
      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com', returnMode: 'pattern', pattern: 'b'},
        res,
        runtime,
      );
      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com', returnMode: 'pattern'},
        res,
        runtime,
      );
      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com', returnMode: 'top-priority'},
        res,
        runtime,
      );
      await invokeTool(
        searchInScripts as unknown as ToolDefinitionHarness,
        {pattern: 'abc', limit: 1},
        res,
        runtime,
      );
      await invokeTool(
        collectionDiff as unknown as ToolDefinitionHarness,
        {
          previous: [{url: 'old.js', size: 1, type: 'external'}],
          includeUnchanged: true,
        },
        res,
        runtime,
      );
      await invokeTool(
        collectionDiff as unknown as ToolDefinitionHarness,
        {
          previous: [
            {url: 'a.js', size: 1, type: 'external'},
            {url: 'same.js', size: 2, type: 'external'},
          ],
          current: [
            {url: 'a.js', size: 3, type: 'external'},
            {url: 'same.js', size: 2, type: 'external'},
          ],
          includeUnchanged: true,
        },
        res,
        runtime,
      );
      await invokeTool(
        collectionDiff as unknown as ToolDefinitionHarness,
        {
          previous: [{url: 'same.js', size: 2, type: 'external'}],
          current: [{url: 'same.js', size: 2, type: 'external'}],
          includeUnchanged: false,
        },
        res,
        runtime,
      );

      await invokeTool(
        queryDom as unknown as ToolDefinitionHarness,
        {selector: '#x', all: false},
        res,
        runtime,
      );
      await invokeTool(
        queryDom as unknown as ToolDefinitionHarness,
        {selector: '.x', all: true, limit: 2},
        res,
        runtime,
      );
      await invokeTool(
        getDomStructure as unknown as ToolDefinitionHarness,
        {maxDepth: 2, includeText: true},
        res,
        runtime,
      );
      await invokeTool(
        findClickableElements as unknown as ToolDefinitionHarness,
        {filterText: 'x'},
        res,
        runtime,
      );

      await invokeTool(
        createHook as unknown as ToolDefinitionHarness,
        {type: 'fetch'},
        res,
        runtime,
      );
      await invokeTool(
        injectHook as unknown as ToolDefinitionHarness,
        {hookId: 'h1'},
        res,
        runtime,
      );
      await invokeTool(
        getHookData as unknown as ToolDefinitionHarness,
        {hookId: 'h1', view: 'detail'},
        res,
        runtime,
      );
      await invokeTool(
        getHookData as unknown as ToolDefinitionHarness,
        {},
        res,
        runtime,
      );
      await invokeTool(
        getHookData as unknown as ToolDefinitionHarness,
        {hookId: 'h1', view: 'summary', maxRecords: 2},
        res,
        runtime,
      );
      await invokeTool(
        getHookData as unknown as ToolDefinitionHarness,
        {view: 'summary', maxRecords: 1},
        res,
        runtime,
      );
      await invokeTool(
        removeHook as unknown as ToolDefinitionHarness,
        {hookId: 'h1'},
        res,
        runtime,
      );
      await assert.rejects(
        () =>
          invokeTool(
            removeHook as unknown as ToolDefinitionHarness,
            {hookId: 'missing'},
            res,
            runtime,
          ),
        (err: unknown) => err instanceof ToolError && err.code === 'NOT_FOUND',
      );

      await invokeTool(
        click as unknown as ToolDefinitionHarness,
        {selector: '#x'},
        res,
        runtime,
      );
      await invokeTool(
        waitForElement as unknown as ToolDefinitionHarness,
        {selector: '#x', timeout: 100},
        res,
        runtime,
      );
      await invokeTool(
        getPerformanceMetrics as unknown as ToolDefinitionHarness,
        {},
        res,
        runtime,
      );
      await invokeTool(
        saveSessionState as unknown as ToolDefinitionHarness,
        {sessionId: 's1'},
        res,
        runtime,
      );
      await invokeTool(
        saveSessionState as unknown as ToolDefinitionHarness,
        {
          sessionId: 's-empty',
          includeCookies: false,
          includeLocalStorage: false,
          includeSessionStorage: false,
        },
        res,
        runtime,
      );
      await invokeTool(
        restoreSessionState as unknown as ToolDefinitionHarness,
        {sessionId: 's1', clearStorageBeforeRestore: true},
        res,
        runtime,
      );
      await invokeTool(
        restoreSessionState as unknown as ToolDefinitionHarness,
        {sessionId: 's1', navigateToSavedUrl: false},
        res,
        runtime,
      );
      await invokeTool(
        listSessionStates as unknown as ToolDefinitionHarness,
        {},
        res,
        runtime,
      );
      await invokeTool(
        dumpSessionState as unknown as ToolDefinitionHarness,
        {sessionId: 's1', pretty: false},
        res,
        runtime,
      );
      const tempDir = await mkdtemp(join(tmpdir(), 'js-reverse-mcp-'));
      const snapshotPath = join(tempDir, 'session-s1.json');
      const encryptedSnapshotPath = join(tempDir, 'session-s1.encrypted.json');
      const originalEncryptionKey = process.env.SESSION_STATE_ENCRYPTION_KEY;
      try {
        await invokeTool(
          dumpSessionState as unknown as ToolDefinitionHarness,
          {sessionId: 's1', path: snapshotPath},
          res,
          runtime,
        );
        const snapshotJson = await readFile(snapshotPath, 'utf8');
        process.env.SESSION_STATE_ENCRYPTION_KEY = 'unit-test-session-key';
        await invokeTool(
          dumpSessionState as unknown as ToolDefinitionHarness,
          {
            sessionId: 's1',
            path: encryptedSnapshotPath,
            encrypt: true,
          },
          res,
          runtime,
        );
        await invokeTool(
          loadSessionState as unknown as ToolDefinitionHarness,
          {
            path: encryptedSnapshotPath,
            sessionId: 's1-encrypted',
            overwrite: true,
          },
          res,
          runtime,
        );
        process.env.SESSION_STATE_ENCRYPTION_KEY = '';
        await assert.rejects(async () => {
          await invokeTool(
            dumpSessionState as unknown as ToolDefinitionHarness,
            {
              sessionId: 's1',
              path: encryptedSnapshotPath,
              encrypt: true,
            },
            res,
            runtime,
          );
        });
        await assert.rejects(async () => {
          await invokeTool(
            loadSessionState as unknown as ToolDefinitionHarness,
            {
              path: encryptedSnapshotPath,
              sessionId: 's1-encrypted-2',
              overwrite: true,
            },
            res,
            runtime,
          );
        });
        await invokeTool(
          deleteSessionState as unknown as ToolDefinitionHarness,
          {sessionId: 's1'},
          res,
          runtime,
        );
        await invokeTool(
          loadSessionState as unknown as ToolDefinitionHarness,
          {snapshotJson, sessionId: 's1'},
          res,
          runtime,
        );
        await assert.rejects(async () => {
          await invokeTool(
            loadSessionState as unknown as ToolDefinitionHarness,
            {snapshotJson, sessionId: 's1'},
            res,
            runtime,
          );
        });
        await invokeTool(
          loadSessionState as unknown as ToolDefinitionHarness,
          {path: snapshotPath, sessionId: 's1', overwrite: true},
          res,
          runtime,
        );

        const expiredSnapshotJson = JSON.stringify({
          id: 'expired-one',
          savedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() - 5_000).toISOString(),
          url: 'https://expired.example.com',
          title: 'expired',
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        });
        await invokeTool(
          loadSessionState as unknown as ToolDefinitionHarness,
          {snapshotJson: expiredSnapshotJson, overwrite: true},
          res,
          runtime,
        );
        await invokeTool(
          listSessionStates as unknown as ToolDefinitionHarness,
          {},
          res,
          runtime,
        );
      } finally {
        process.env.SESSION_STATE_ENCRYPTION_KEY = originalEncryptionKey;
        await rm(tempDir, {recursive: true, force: true});
      }
      await assert.rejects(async () => {
        await invokeTool(
          restoreSessionState as unknown as ToolDefinitionHarness,
          {sessionId: 'missing-session'},
          res,
          runtime,
        );
      });
      await assert.rejects(async () => {
        await invokeTool(
          dumpSessionState as unknown as ToolDefinitionHarness,
          {sessionId: 'missing-session'},
          res,
          runtime,
        );
      });
      await assert.rejects(async () => {
        await invokeTool(
          loadSessionState as unknown as ToolDefinitionHarness,
          {},
          res,
          runtime,
        );
      });
      await assert.rejects(async () => {
        await invokeTool(
          loadSessionState as unknown as ToolDefinitionHarness,
          {snapshotJson: '{bad json}, res, runtime'},
          res,
          runtime,
        );
      });
      await assert.rejects(async () => {
        await invokeTool(
          loadSessionState as unknown as ToolDefinitionHarness,
          {snapshotJson: '1'},
          res,
          runtime,
        );
      });
      await invokeTool(
        checkBrowserHealth as unknown as ToolDefinitionHarness,
        {},
        res,
        runtime,
      );
      runtime.browserManager.getBrowser = () => ({isConnected: () => false});
      runtime.pageController.getPage = async () => activePage;
      runtime.pageController.evaluate = async () => 2;
      runtime.collector.getStatus = async () => ({
        running: true,
        pagesCount: 1,
        version: 'Chrome/145',
      });
      const falseNegativeHealthStart = res.lines.length;
      await invokeTool(
        checkBrowserHealth as unknown as ToolDefinitionHarness,
        {},
        res,
        runtime,
      );
      const falseNegativeHealth = res.lines
        .slice(falseNegativeHealthStart)
        .join('\n');
      assert.ok(
        falseNegativeHealth.includes('"pageReady": true') ||
          falseNegativeHealth.includes('"pageReady":true'),
      );
      assert.ok(!falseNegativeHealth.includes('BROWSER_DISCONNECTED'));
      runtime.browserManager.getBrowser = () => ({isConnected: () => false});
      runtime.collector.getStatus = async () => ({
        running: false,
        pagesCount: 0,
      });
      runtime.pageController.getPage = async () => {
        throw new Error('no page');
      };
      await invokeTool(
        checkBrowserHealth as unknown as ToolDefinitionHarness,
        {},
        res,
        runtime,
      );
      runtime.pageController.getPage = async () => activePage;

      await invokeTool(
        injectStealth as unknown as ToolDefinitionHarness,
        {preset: 'windows-chrome'},
        res,
        runtime,
      );
      await invokeTool(
        listStealthPresets as unknown as ToolDefinitionHarness,
        {},
        res,
        runtime,
      );
      await invokeTool(
        listStealthFeatures as unknown as ToolDefinitionHarness,
        {},
        res,
        runtime,
      );
      await invokeTool(
        setUserAgent as unknown as ToolDefinitionHarness,
        {userAgent: 'ua-test'},
        res,
        runtime,
      );

      await assert.rejects(
        () =>
          invokeTool(
            injectHook as unknown as ToolDefinitionHarness,
            {hookId: 'missing'},
            res,
            runtime,
          ),
        (err: unknown) => err instanceof ToolError,
      );

      assert.ok(res.lines.some(line => line.includes('Hook injected: h1')));
      assert.ok(
        res.lines.some(line =>
          line.includes('Successfully clicked on element'),
        ),
      );
      assert.ok(res.lines.some(line => line.includes('User-Agent updated.')));
      assert.ok(res.lines.some(line => line.includes('"healthy"')));
      assert.ok(res.lines.some(line => line.includes('BROWSER_DISCONNECTED')));
      assert.ok(res.lines.some(line => line.includes('"unique"')));
      assert.ok(res.lines.some(line => line.includes('"overwritten"')));
      assert.ok(res.lines.some(line => line.includes('"remaining"')));
      assert.ok(res.lines.some(line => line.includes('"bodySnippet"')));
      assert.ok(
        res.lines.some(
          line =>
            line.includes('"encrypted": true') ||
            line.includes('"encrypted":true'),
        ),
      );
      assert.ok(res.lines.some(line => line.includes('"cleanedExpired":')));
    } finally {
      runtime.collector.collect = originals.collect;
      runtime.collector.getFilesByPattern = originals.getFilesByPattern;
      runtime.collector.getCollectedFilesSummary =
        originals.getCollectedFilesSummary;
      runtime.collector.getTopPriorityFiles = originals.getTopPriorityFiles;
      runtime.domInspector.querySelector = originals.querySelector;
      runtime.domInspector.querySelectorAll = originals.querySelectorAll;
      runtime.domInspector.getStructure = originals.getStructure;
      runtime.domInspector.findClickable = originals.findClickable;
      runtime.hookManager.create = originals.createHook;
      runtime.hookManager.getHook = originals.getHook;
      runtime.hookManager.getAllHooks = originals.getAllHooks;
      runtime.hookManager.getRecords = originals.getRecords;
      runtime.hookManager.exportData = originals.exportData;
      runtime.hookManager.getStats = originals.getStats;
      runtime.hookManager.remove = originals.removeHook;
      runtime.pageController.injectScript = originals.injectScript;
      runtime.pageController.navigate = originals.navigate;
      runtime.pageController.click = originals.click;
      runtime.pageController.type = originals.type;
      runtime.pageController.waitForSelector = originals.waitForSelector;
      runtime.pageController.screenshot = originals.screenshot;
      runtime.pageController.getPerformanceMetrics = originals.metrics;
      runtime.pageController.getPage = originals.getPage;
      runtime.pageController.getCookies = originals.getCookies;
      runtime.pageController.getLocalStorage = originals.getLocalStorage;
      runtime.pageController.getSessionStorage = originals.getSessionStorage;
      runtime.pageController.clearCookies = originals.clearCookies;
      runtime.pageController.clearLocalStorage = originals.clearLocalStorage;
      runtime.pageController.clearSessionStorage =
        originals.clearSessionStorage;
      runtime.pageController.setCookies = originals.setCookies;
      runtime.pageController.setLocalStorage = originals.setLocalStorage;
      runtime.pageController.setSessionStorage = originals.setSessionStorage;
      runtime.pageController.replayActions = originals.replayActions;
      runtime.pageController.evaluate = originals.evaluate;
      runtime.collector.getActivePage = originals.getActivePage;
      runtime.collector.getStatus = originals.getStatus;
      runtime.browserManager.getBrowser = originals.getBrowser;
      stealth.injectAll = originals.injectAll;
      stealth.getPresets = originals.getPresets;
    }
  });
});
