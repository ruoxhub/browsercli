/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const PROBE_ATTR = 'data-pcli-css-probe';

/**
 * 在页面上高亮目标元素（DevTools Elements 面板式的视觉定位）。
 *
 * 原生实现：probe 属性桥接 → Overlay.highlightNode → 延时 hideHighlight。
 * DevTools 面板导航（reveal-in-panel）需要前端 UI 命令通道，同样未实现。
 */
export const revealInDevtools = defineTool({
  name: 'reveal_in_devtools',
  description:
    '在页面上高亮指定元素（相当于 DevTools Elements 面板的节点高亮），持续指定时间后自动消失。用于逆向分析时快速定位目标 DOM。',
  annotations: {
    title: '高亮元素',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .describe('目标元素的定位器（支持 CSS、role=、text=、xpath=）。'),
    durationMs: zod
      .number()
      .int()
      .min(200)
      .max(30000)
      .optional()
      .describe('高亮持续时间（毫秒），默认 3000。'),
  },
  handler: async (request, response, context) => {
    const {selector, durationMs = 3000} = request.params;
    const frame = (context as Context).getSelectedFrame();
    if (!frame) {
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'reveal_in_devtools',
      });
    }
    const page = frame.page();

    const probe = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    try {
      const element = frame.locator(selector).first();
      await element.evaluate(
        (node, [attr, value]) => {
          node.setAttribute(attr, value);
        },
        [PROBE_ATTR, probe],
      );

      await withCdpSession(page, async client => {
        await client.send('DOM.enable');
        await client.send('Overlay.enable');
        const {root} = (await client.send('DOM.getDocument', {
          depth: 0,
        })) as {root: {nodeId: number}};
        const {nodeId} = (await client.send('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: `[${PROBE_ATTR}="${probe}"]`,
        })) as {nodeId: number};
        if (!nodeId) {
          throw createToolError(
            ErrorCodes.VALIDATION,
            `元素定位成功但 CDP 查询失败：${selector}`,
            {toolName: 'reveal_in_devtools', selector},
          );
        }
        await client.send('Overlay.highlightNode', {
          nodeId,
          highlightConfig: {
            showInfo: true,
            showStyles: true,
            contentColor: {r: 111, g: 168, b: 220, a: 1},
          },
        });
        setTimeout(() => {
          void withCdpSession(page, c => c.send('Overlay.hideHighlight')).catch(
            () => undefined,
          );
        }, durationMs).unref?.();
      });

      response.setStructuredContent({
        success: true,
        message: `Element ${selector} highlighted for ${durationMs}ms.`,
        tooltype: 'reveal_in_devtools',
        data: {selector, durationMs},
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'reveal_in_devtools', selector});
    } finally {
      try {
        await frame
          .locator(selector)
          .first()
          .evaluate((node, attr) => {
            node.removeAttribute(attr);
          }, PROBE_ATTR);
      } catch {
        // 元素可能已被移除
      }
    }
  },
});
