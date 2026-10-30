/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {getErrorMessage} from '../shared/pageResponse.js';
import {defineTool} from '../ToolDefinition.js';

import type {InjectHookData} from './types.js';

const isolatedWarning =
  'requestedWorld isolated is not supported; effectiveWorld is main.';

export const injectHook = defineTool({
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
    const runtime = getRuntime();
    const resolvedScript =
      request.params.script ?? runtime.hookManager.getHook(hookId)?.script;

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
        await context.getSelectedFrame().evaluate(script);
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

export const listPersistentHooks = defineTool({
  name: 'list_persistent_hooks',
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
