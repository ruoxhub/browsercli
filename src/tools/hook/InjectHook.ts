/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';
import {errorMessage} from '../shared/pageResponse.js';
import type {InjectHookData} from './types.js';

/**
 * Hook 持久化注册表：
 *   key = hookId，value = 原始脚本
 *
 * 用途：
 *   - inject_hook 在 persistent=true 时将脚本写入这里，并对 selectedPage
 *     调用 addInitScript，确保后续导航 / 新 document 自动重新挂 hook。
 *   - list_persistent_hooks / remove_persistent_hook 可以按 hookId 操作。
 *
 * 注：这是 worker 进程内存状态；页面关闭 / worker 重启后自然失效。
 */
const persistentHookRegistry = new Map<string, {script: string; registeredAt: number; world: 'main' | 'isolated'}>();

export function getPersistentHookRegistry(): ReadonlyMap<string, {script: string; registeredAt: number; world: 'main' | 'isolated'}> {
  return persistentHookRegistry;
}

/**
 * 向页面注入 Hook 脚本。
 *
 * 支持两种模式：
 *   - persistent=false（默认）：原 evaluate 语义，页面导航后失效
 *   - persistent=true：使用 page.addInitScript 注册到 selectedPage，
 *     同时立即在当前 frame 执行一遍，保证本页和后续新 document 都挂载
 */
export const injectHook = defineTool({
  name: 'inject_hook',
  description:
    'Inject a hook script. Use persistent=true to keep the hook alive across page navigations (registers via Page.addScriptToEvaluateOnNewDocument and also runs once on the current frame).',
  annotations: {
    title: 'Inject Hook',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod.string().describe('Hook identifier for logging and tracking'),
    script: zod.string().describe('Hook script code to inject'),
    persistent: zod
      .boolean()
      .optional()
      .describe(
        '是否跨导航持久化。true 时 hook 会注册到 page.addInitScript，' +
          '后续整页导航、页面刷新、window.open 打开的新 document 都会自动挂载此 hook。' +
          '同时当前 frame 会立即执行一次以保证本页生效。默认 false（仅当前文档生效）。',
      ),
    world: zod
      .enum(['main', 'isolated'])
      .optional()
      .describe(
        '执行上下文。main（默认）= 页面 JS 可直接访问的上下文；' +
          'isolated = 隔离上下文，适合不需要访问页面变量的监控 hook。',
      ),
  },
  handler: async (request, response, context) => {
    const {hookId, script} = request.params;
    const persistent = request.params.persistent ?? false;
    const world = request.params.world ?? 'main';

    const ctx = context as Context;
    const frame = ctx.getSelectedFrame();

    const result: InjectHookData = {
      hookId,
      persisted: false,
      ranOnCurrentFrame: false,
      world,
      persistentStrategy: 'evaluate-once',
    };
    const warnings: string[] = [];

    try {
      if (persistent) {
        const selectedPage = ctx.getSelectedPage();
        // 注：addInitScript 只对 this.selectedPage 生效，对未来用
        // context.newPage() 开启的新 page 不会自动继承。
        // TODO(P2-#7): 结合 page-state 持久化改造，升级成 browser-context 级别。
        const addInit = (selectedPage as unknown as {
          addInitScript?: (script: string) => Promise<void>;
        }).addInitScript;
        if (typeof addInit === 'function') {
          await addInit.call(selectedPage, script);
          persistentHookRegistry.set(hookId, {
            script,
            registeredAt: Date.now(),
            world,
          });
          result.persisted = true;
          result.persistentStrategy = 'addInitScript + framenavigated';

          // Register framenavigated re-mount for resilience
          const onPage = selectedPage as unknown as {
            on?: (event: string, handler: (f: any) => Promise<void>) => void;
            mainFrame?: () => any;
          };
          if (
            typeof onPage.on === 'function' &&
            typeof onPage.mainFrame === 'function'
          ) {
            onPage.on('framenavigated', async (navigatedFrame: any) => {
              if (navigatedFrame === onPage.mainFrame!()) {
                const exists = await navigatedFrame
                  .evaluate(
                    '(hookId) => typeof window.__hookStore !== "undefined"',
                    hookId,
                  )
                  .catch(() => false);
                if (!exists) {
                  await navigatedFrame.evaluate(script).catch(() => {});
                }
              }
            });
            if (world === 'isolated') {
              warnings.push(
                'framenavigated 重挂载在 main world 执行（Playwright 限制），isolated world hook 导航后可能无法访问隔离上下文',
              );
            }
          }
        } else {
          warnings.push(
            'selectedPage 不支持 addInitScript，跨导航持久化失败，已降级为单次 evaluate',
          );
        }
      }

      // 始终在当前 frame 跑一次，让 hook 对本页立即生效
      await frame.evaluate(script);
      result.ranOnCurrentFrame = true;

      if (warnings.length) {
        result.warnings = warnings;
      }

      response.setStructuredContent({
        success: true,
        message: persistent
          ? `Hook ${hookId} injected (${world} world${result.persisted ? ', persistent across navigations' : ''})`
          : `Hook injected: ${hookId} (${world} world)`,
        tooltype: 'inject_hook',
        data: result,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `注入失败：${errorMessage(error)}`,
        tooltype: 'inject_hook',
        data: {
          hookId,
          persisted: result.persisted,
          ranOnCurrentFrame: result.ranOnCurrentFrame,
          world,
          persistentStrategy: result.persistentStrategy,
        },
      });
    }
  },
});

/**
 * 列出当前 worker 进程内已注册的持久化 hook。
 *
 * 注意：这只反映通过 inject_hook --persistent true 注册的；不感知
 * 用户直接通过 inject_preload_script 或 evaluate_script 挂的 script。
 */
export const listPersistentHooks = defineTool({
  name: 'list_persistent_hooks',
  description:
    'List persistent hooks registered via inject_hook --persistent=true in the current worker session.',
  annotations: {
    title: 'List Persistent Hooks',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const entries = Array.from(persistentHookRegistry.entries()).map(
      ([hookId, {script, registeredAt}]) => ({
        hookId,
        registeredAt: new Date(registeredAt).toISOString(),
        scriptSize: script.length,
        scriptPreview:
          script.length > 200 ? `${script.slice(0, 200)}…` : script,
      }),
    );

    response.setStructuredContent({
      success: true,
      message: `${entries.length} persistent hook(s) registered`,
      tooltype: 'list_persistent_hooks',
      data: {hooks: entries, count: entries.length},
    });
  },
});
