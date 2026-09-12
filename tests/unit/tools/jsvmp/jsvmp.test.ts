/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import vm from 'node:vm';

import type {BrowserContext, Frame, Page} from 'patchright';

import {PersistentHookRegistry} from '../../../../src/modules/hook/PersistentHookRegistry.js';
import {
  compareEnv,
  hookJsvmpInterpreter,
} from '../../../../src/tools/jsvmp/jsvmp.js';
import {manifest as jsvmpManifest} from '../../../../src/tools/jsvmp/manifest.js';
import type {Context, Response} from '../../../../src/tools/ToolDefinition.js';

interface HookResultData {
  status: string;
  mode: string;
  persistent: boolean;
  data_location: string;
  applied_frames: number;
  warnings: string[];
}

interface EnvironmentResultValue {
  value: unknown;
  type?: string;
  error?: string;
}

interface EnvironmentResultData {
  navigator: Record<string, EnvironmentResultValue>;
  screen: Record<string, EnvironmentResultValue>;
  canvas: Record<string, EnvironmentResultValue>;
  timing: Record<string, EnvironmentResultValue>;
  custom: Record<string, EnvironmentResultValue>;
}

interface StructuredResult {
  success: boolean;
  message: string;
  tooltype: string;
  data?: unknown;
}

function responseHarness() {
  let content: StructuredResult | undefined;
  return {
    response: {
      setStructuredContent(value: StructuredResult) {
        content = value;
      },
    } as unknown as Response,
    get content(): StructuredResult {
      assert.ok(content);
      return content;
    },
  };
}

function resultData<T>(result: StructuredResult): T {
  assert.notEqual(result.data, undefined);
  return result.data as T;
}

function createBrowserRealm(): vm.Context {
  const realm = vm.createContext({
    console: {log: () => undefined, warn: () => undefined},
  });
  vm.runInContext(
    `
class Navigator {
  get userAgent() { return 'BrowserCLI/2.0'; }
  get platform() { return 'TestOS'; }
  get language() { return 'zh-CN'; }
  get languages() { return ['zh-CN', 'en-US']; }
  get hardwareConcurrency() { return 8; }
  get deviceMemory() { return 16; }
  get maxTouchPoints() { return 0; }
  get vendor() { return 'BrowserCLI'; }
  get cookieEnabled() { return true; }
  get webdriver() { return undefined; }
}
class Screen {
  get width() { return 1920; }
  get height() { return 1080; }
  get availWidth() { return 1920; }
  get availHeight() { return 1040; }
  get colorDepth() { return 24; }
}
class History {
  get length() { return 1; }
}
class Performance {
  get timeOrigin() { return 1; }
  now() { return 2; }
}
class Location {
  get href() { return 'https://example.com/app'; }
}
class Document {
  get visibilityState() { return 'visible'; }
}
class HTMLDocument extends Document {}

globalThis.window = globalThis;
globalThis.navigator = new Navigator();
globalThis.screen = new Screen();
globalThis.history = new History();
globalThis.performance = new Performance();
globalThis.location = new Location();
globalThis.document = new HTMLDocument();
globalThis.localStorage = {};
globalThis.sessionStorage = {};
globalThis.devicePixelRatio = 1.5;
globalThis.customObject = {ok: true};
`,
    realm,
  );
  return realm;
}

function contextHarness(
  options: {
    frameUrl?: string;
    evaluateError?: Error;
  } = {},
) {
  const realm = createBrowserRealm();
  const evaluatedScripts: string[] = [];
  const initScripts: string[] = [];
  const frameUrl = options.frameUrl ?? 'https://example.com/app';
  const frame = {
    url: () => frameUrl,
    evaluate: async (value: string | CallableFunction, argument?: unknown) => {
      if (options.evaluateError) throw options.evaluateError;
      if (typeof value === 'string') {
        evaluatedScripts.push(value);
        return vm.runInContext(value, realm);
      }
      const serializedArgument =
        argument === undefined ? 'undefined' : JSON.stringify(argument);
      return vm.runInContext(
        `(${value.toString()})(${serializedArgument})`,
        realm,
      );
    },
  } as unknown as Frame;
  const page = {
    isClosed: () => false,
    frames: () => [frame],
    url: () => frameUrl,
  } as unknown as Page;
  const browserContext = {
    isClosed: () => false,
    once: () => browserContext,
    addInitScript: async (script: string) => {
      initScripts.push(script);
      return {dispose: async () => undefined};
    },
    pages: () => [page],
  } as unknown as BrowserContext;
  const registry = new PersistentHookRegistry();
  const context = {
    getSelectedFrame: () => frame,
    getSelectedPage: () => page,
    getBrowserContext: () => browserContext,
    getPersistentHookRegistry: () => registry,
  } as unknown as Context;

  return {
    browserContext,
    context,
    evaluatedScripts,
    initScripts,
    realm,
    registry,
  };
}

function readJsvmpLog(realm: vm.Context): Array<Record<string, unknown>> {
  const serialized = vm.runInContext(
    'JSON.stringify(window.__mcp_jsvmp_log || [])',
    realm,
  ) as string;
  return JSON.parse(serialized) as Array<Record<string, unknown>>;
}

describe('hook_jsvmp_interpreter', () => {
  it('registers transparent mode for existing and future documents by default', async () => {
    const harness = contextHarness();
    const output = responseHarness();

    await hookJsvmpInterpreter.handler(
      {params: {mode: 'transparent', script_url: 'sdk.js'}},
      output.response,
      harness.context,
    );

    const registrations = harness.registry.list(harness.browserContext);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].hookId, 'jsvmp_transparent:sdk.js');
    assert.equal(registrations[0].applyMode, 'existing-and-future');
    assert.equal(harness.initScripts.length, 1);
    assert.equal(harness.evaluatedScripts.length, 1);
    assert.equal(output.content.success, true);
    const data = resultData<HookResultData>(output.content);
    assert.equal(data.status, 'instrumented');
    assert.equal(data.mode, 'transparent');
    assert.equal(data.persistent, true);
    assert.equal(data.data_location, 'window.__mcp_jsvmp_log');
    assert.equal(data.applied_frames, 1);
    assert.match(data.warnings[0], /navigate_page.*reload/);

    vm.runInContext(
      'navigator.userAgent;\n//# sourceURL=sdk.js',
      harness.realm,
    );
    assert.ok(
      readJsvmpLog(harness.realm).some(
        entry => entry.type === 'transparent_get' && entry.key === 'userAgent',
      ),
    );
  });

  it('maps proxy options into a one-shot probe', async () => {
    const harness = contextHarness({frameUrl: 'about:blank'});
    const output = responseHarness();

    await hookJsvmpInterpreter.handler(
      {
        params: {
          persistent: false,
          mode: 'proxy',
          script_url: '',
          track_calls: false,
          track_props: true,
          track_reflect: false,
          proxy_objects: ['navigator'],
          max_entries: 1,
        },
      },
      output.response,
      harness.context,
    );
    vm.runInContext('navigator.userAgent; navigator.platform;', harness.realm);

    assert.equal(harness.registry.list(harness.browserContext).length, 0);
    assert.equal(harness.evaluatedScripts.length, 1);
    assert.deepEqual(
      readJsvmpLog(harness.realm).map(entry => entry.type),
      ['proxy_get'],
    );
    const data = resultData<HookResultData>(output.content);
    assert.equal(data.persistent, false);
    assert.match(data.warnings[0], /detectable/i);
  });

  it('rejects with a ToolError when current-frame injection fails', async () => {
    const harness = contextHarness({
      evaluateError: new Error('frame detached'),
    });
    const output = responseHarness();

    await assert.rejects(
      hookJsvmpInterpreter.handler(
        {params: {persistent: false, mode: 'transparent'}},
        output.response,
        harness.context,
      ),
      (error: unknown) =>
        error instanceof Error && /frame detached/.test(error.message),
    );
  });

  it('rejects with a ToolError when no frame is selected', async () => {
    const output = responseHarness();
    const context = {
      getSelectedFrame: () => {
        throw new Error('no selected frame');
      },
    } as unknown as Context;

    await assert.rejects(
      hookJsvmpInterpreter.handler(
        {params: {persistent: false, mode: 'transparent'}},
        output.response,
        context,
      ),
      (error: unknown) =>
        error instanceof Error && /no selected frame/.test(error.message),
    );
  });
});

describe('compare_env', () => {
  it('collects standard fingerprint fields and requested expressions', async () => {
    const harness = contextHarness();
    const output = responseHarness();

    await compareEnv.handler(
      {
        params: {
          properties: [
            'navigator.userAgent',
            'window.customObject',
            'missing.value',
          ],
        },
      },
      output.response,
      harness.context,
    );

    assert.equal(output.content.success, true);
    const data = resultData<EnvironmentResultData>(output.content);
    assert.equal(data.navigator.userAgent.value, 'BrowserCLI/2.0');
    assert.equal(data.screen.width.value, 1920);
    assert.equal(data.screen.devicePixelRatio.value, 1.5);
    assert.equal(data.timing.timezone.type, 'string');
    assert.deepEqual(Object.keys(data.canvas), []);
    assert.equal(data.custom['window.customObject'].value, '{"ok":true}');
    assert.match(
      data.custom['missing.value'].error ?? '',
      /missing is not defined/,
    );
  });
});

describe('JSVMP tool manifest', () => {
  it('exposes both tools in the workflow profile', () => {
    assert.equal(jsvmpManifest.profile, 'workflow');
    assert.deepEqual(jsvmpManifest.tools, [
      {modulePath: './jsvmp/jsvmp.js', handlerName: 'hookJsvmpInterpreter'},
      {modulePath: './jsvmp/jsvmp.js', handlerName: 'compareEnv'},
    ]);
  });
});
