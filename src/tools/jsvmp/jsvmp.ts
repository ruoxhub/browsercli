/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {RegisterPersistentHookResult} from '../../modules/hook/PersistentHookRegistry.js';
import {zod} from '../../third_party/index.js';
import type {BrowserContext} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {errorMessage} from '../shared/pageResponse.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {buildJsvmpProxyHook, buildJsvmpTransparentHook} from './hookScripts.js';

type JsvmpMode = 'proxy' | 'transparent';

interface HookJsvmpParams {
  script_url?: string;
  persistent?: boolean;
  mode?: JsvmpMode;
  track_calls?: boolean;
  track_props?: boolean;
  track_reflect?: boolean;
  proxy_objects?: string[];
  max_entries?: number;
}

interface EnvironmentValue {
  value: unknown;
  type?: string;
  error?: string;
}

interface EnvironmentSnapshot {
  navigator: Record<string, EnvironmentValue>;
  screen: Record<string, EnvironmentValue>;
  canvas: Record<string, EnvironmentValue>;
  webgl: Record<string, EnvironmentValue>;
  audio: Record<string, EnvironmentValue>;
  timing: Record<string, EnvironmentValue>;
  misc: Record<string, EnvironmentValue>;
  custom: Record<string, EnvironmentValue>;
}

const DEFAULT_PROXY_OBJECTS = [
  'navigator',
  'screen',
  'history',
  'localStorage',
  'sessionStorage',
  'performance',
];

const PROXY_DETECTION_WARNING =
  'proxy mode is detectable by RS/AK-style signature-based anti-bot checks.';

const LATE_INSTALL_WARNING =
  "Hooks were installed on an already-loaded document. A synchronously loaded SDK may already hold native references; call navigate_page(type='reload') or navigate again to reinitialize it with the probe active.";

const hookSchema = {
  script_url: zod
    .string()
    .optional()
    .describe('用于调用栈过滤的目标脚本 URL 子串；省略时不过滤'),
  persistent: zod
    .boolean()
    .optional()
    .describe('是否注册到当前 BrowserContext 并跨导航保留，默认 true'),
  mode: zod
    .enum(['proxy', 'transparent'])
    .optional()
    .describe('proxy 覆盖更完整但可检测；transparent 仅观察原型 getter'),
  track_calls: zod
    .boolean()
    .optional()
    .describe('proxy 模式下是否追踪 apply/call/bind 与时间 API'),
  track_props: zod
    .boolean()
    .optional()
    .describe('proxy 模式下是否代理全局对象属性访问'),
  track_reflect: zod
    .boolean()
    .optional()
    .describe('proxy 模式下是否追踪 Reflect.get/apply/set/construct'),
  proxy_objects: zod
    .array(zod.string())
    .optional()
    .describe('proxy 模式下要代理的 window 属性名列表'),
  max_entries: zod
    .number()
    .int()
    .positive()
    .optional()
    .describe('window.__mcp_jsvmp_log 的最大记录数，默认 10000'),
};

export function buildJsvmpHook(
  mode: JsvmpMode,
  params: HookJsvmpParams,
): string {
  const scriptUrl = params.script_url ?? '';
  const maxEntries = params.max_entries ?? 10_000;
  if (mode === 'transparent') {
    return buildJsvmpTransparentHook({scriptUrl, maxEntries});
  }
  return buildJsvmpProxyHook({
    scriptUrl,
    maxEntries,
    trackCalls: params.track_calls ?? true,
    trackProps: params.track_props ?? true,
    trackReflect: params.track_reflect ?? true,
    proxyObjects: params.proxy_objects ?? DEFAULT_PROXY_OBJECTS,
  });
}

export function createJsvmpHookId(mode: JsvmpMode, scriptUrl: string): string {
  const scope = scriptUrl || 'all';
  return mode === 'transparent'
    ? `jsvmp_transparent:${scope}`
    : `jsvmp_probe:${scope}`;
}

function requireOpenBrowserContext(context: Context): BrowserContext {
  const browserContext = context.getBrowserContext();
  if (!browserContext || browserContext.isClosed()) {
    throw new Error('当前 BrowserContext 不可用或已关闭，无法注册持久探针');
  }
  return browserContext;
}

function isLoadedDocument(url: string): boolean {
  return Boolean(url && url !== 'about:blank');
}

export const hookJsvmpInterpreter = defineTool({
  name: 'hook_jsvmp_interpreter',
  description:
    '安装 JSVMP 运行时探针。proxy 模式覆盖调用、Reflect 与全局属性但可检测；transparent 模式仅替换可配置的原型 getter，痕迹更少。应在目标 SDK 加载前调用。',
  annotations: {
    title: 'Hook JSVMP Interpreter',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: hookSchema,
  handler: async (request, response, context) => {
    const params = request.params as HookJsvmpParams;
    const mode = params.mode ?? 'proxy';
    const persistent = params.persistent ?? true;
    const scriptUrl = params.script_url ?? '';
    let registration: RegisterPersistentHookResult | undefined;

    try {
      const frame = context.getSelectedFrame();
      const frameUrl = frame.url();
      const script = buildJsvmpHook(mode, params);
      if (persistent) {
        registration = await context.getPersistentHookRegistry().register({
          context: requireOpenBrowserContext(context),
          hookId: createJsvmpHookId(mode, scriptUrl),
          script,
          source: 'inject_hook',
          requestedWorld: 'main',
          applyMode: 'existing-and-future',
        });
      } else {
        await frame.evaluate(script);
      }

      const warnings = [...(registration?.warnings ?? [])];
      if (mode === 'proxy') warnings.unshift(PROXY_DETECTION_WARNING);
      if (isLoadedDocument(frameUrl)) warnings.push(LATE_INSTALL_WARNING);
      const partial = registration?.partial ?? false;

      response.setStructuredContent({
        success: true,
        message: `JSVMP ${mode} probe ${partial ? 'partially ' : ''}installed`,
        tooltype: 'hook_jsvmp_interpreter',
        data: {
          status: partial ? 'partial' : 'instrumented',
          mode,
          script_url: scriptUrl || '(all)',
          persistent,
          data_location: 'window.__mcp_jsvmp_log',
          hook_id: persistent ? createJsvmpHookId(mode, scriptUrl) : undefined,
          registered: registration?.registered,
          idempotent: registration?.idempotent,
          applied_frames: registration?.appliedFrames ?? 1,
          failed_frames: registration?.failedFrames ?? [],
          warnings,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `安装 JSVMP 探针失败：${errorMessage(error)}`,
        tooltype: 'hook_jsvmp_interpreter',
        data: {
          status: 'error',
          mode,
          script_url: scriptUrl || '(all)',
          persistent,
          data_location: 'window.__mcp_jsvmp_log',
        },
      });
    }
  },
});

export function collectEnvironment(properties: string[]): EnvironmentSnapshot {
  const result: EnvironmentSnapshot = {
    navigator: {},
    screen: {},
    canvas: {},
    webgl: {},
    audio: {},
    timing: {},
    misc: {},
    custom: {},
  };

  const navigatorProperties = [
    'userAgent',
    'platform',
    'language',
    'languages',
    'hardwareConcurrency',
    'deviceMemory',
    'maxTouchPoints',
    'vendor',
    'cookieEnabled',
    'webdriver',
  ];
  for (const property of navigatorProperties) {
    try {
      const value = Reflect.get(navigator, property);
      result.navigator[property] = {
        value: String(value),
        type: typeof value,
      };
    } catch (error) {
      result.navigator[property] = {
        value: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const screenProperties = [
    'width',
    'height',
    'availWidth',
    'availHeight',
    'colorDepth',
  ];
  for (const property of screenProperties) {
    try {
      const value = Reflect.get(screen, property);
      result.screen[property] = {value, type: typeof value};
    } catch (error) {
      result.screen[property] = {
        value: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  result.screen.devicePixelRatio = {
    value: window.devicePixelRatio,
    type: typeof window.devicePixelRatio,
  };
  result.timing.timezoneOffset = {
    value: new Date().getTimezoneOffset(),
    type: 'number',
  };
  result.timing.timezone = {
    value: Intl.DateTimeFormat().resolvedOptions().timeZone,
    type: 'string',
  };

  const propertyPathPattern = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
  for (const propertyPath of properties) {
    try {
      if (!propertyPathPattern.test(propertyPath)) {
        throw new Error(
          'Only dot-separated property paths are supported (for example navigator.userAgent)',
        );
      }
      const [root, ...segments] = propertyPath.split('.');
      if (!(root in globalThis)) throw new Error(`${root} is not defined`);
      let value: unknown = Reflect.get(globalThis, root);
      for (const segment of segments) {
        if (value === null || value === undefined) {
          throw new Error(`Cannot read ${segment} from ${String(value)}`);
        }
        value = Reflect.get(Object(value), segment);
      }

      let serializedValue: unknown = String(value);
      if (typeof value === 'object' && value !== null) {
        const serialized = JSON.stringify(value);
        serializedValue =
          typeof serialized === 'string'
            ? serialized.substring(0, 500)
            : String(value);
      }
      result.custom[propertyPath] = {
        value: serializedValue,
        type: typeof value,
      };
    } catch (error) {
      result.custom[propertyPath] = {
        value: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return result;
}

export const compareEnv = defineTool({
  name: 'compare_env',
  description:
    '采集当前 Frame 的浏览器环境基准，用于与 Node.js/jsdom 环境对比。可额外读取安全的点分隔属性路径。',
  annotations: {
    title: 'Compare Browser Environment',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    properties: zod
      .array(zod.string())
      .optional()
      .describe(
        '额外读取的点分隔属性路径，例如 navigator.userAgent；不执行 JavaScript 表达式',
      ),
  },
  handler: async (request, response, context) => {
    try {
      const data = await context
        .getSelectedFrame()
        .evaluate(collectEnvironment, request.params.properties ?? []);
      response.setStructuredContent({
        success: true,
        message: '浏览器环境采集完成',
        tooltype: 'compare_env',
        data,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `浏览器环境采集失败：${errorMessage(error)}`,
        tooltype: 'compare_env',
        data: null,
      });
    }
  },
});
