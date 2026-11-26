/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  formatMatchedStyles,
  type RawMatchedStyles,
  renderCssStylesReport,
} from '../formatters/cssFormatter.js';
import {withCdpSession} from '../modules/browser/cdpUtils.js';
import {zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {NO_ACTIVE_PAGE_MESSAGE} from './shared/activePageResolver.js';
import {resolveTargetLocator, toElementError} from './shared/elementLocator.js';
import {type Context, definePageTool} from './ToolDefinition.js';

// ─── getCssStyles.ts ─────────────────────────────────────

const PROBE_ATTR = 'data-pcli-css-probe';

/**
 * 获取元素匹配的 CSS 规则与层叠信息。支持 uid 与 selector 双模定位。
 *
 * 通过 locator 解析元素（支持 uid 或 CSS/role=/text=/xpath=），注入一次性探针
 * 属性把元素桥接到 CDP CSS 域，再用 CSS.getMatchedStylesForNode 拉取
 * 完整层叠数据并格式化为 active/overloaded 报告。
 *
 * 注意：CDP 侧固定查询页面顶层文档，因此仅支持主 frame 中的元素；
 * 选中子 frame（iframe）时会以「元素定位成功但 CDP 查询失败」收场。
 */
export const getCssStyles = definePageTool({
  name: 'get_css_styles',
  description:
    '获取指定元素匹配的 CSS 规则、内联样式、伪元素与继承样式及层叠（cascade）信息，支持通过 take_snapshot uid 或定位器指定元素。',
  annotations: {
    title: '获取CSS层叠样式',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    uid: zod
      .string()
      .optional()
      .describe('目标元素在 take_snapshot 中的 uid（与 selector 二选一）。'),
    selector: zod
      .string()
      .optional()
      .describe(
        '目标元素的定位器（支持 CSS、role=、text=、xpath=；多匹配时用 >> nth=N 消歧）。未提供 uid 时必填。',
      ),
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('每页返回的 CSS 规则最大条数（默认返回全部）。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('规则页码（从 0 开始，默认第 0 页）。'),
  },
  handler: async (request, response, context) => {
    const {uid, selector, pageSize, pageIdx} = request.params;
    const ctx = context as Context;
    const frame = ctx.getSelectedFrame();
    if (!uid && !frame) {
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'get_css_styles',
      });
    }
    const page = ctx.getSelectedPage?.() ?? frame.page();
    // 探针属性 + DOM.querySelector 基于 page 级顶层文档，子 frame 内的元素
    // 无法桥接；显式报错好过最后以「CDP 查询失败」误导调用方。
    // 仅当上下文确实暴露 parentFrame() 时才判定（测试替身可能没有）。
    const parentFrame = frame
      ? (frame as unknown as {parentFrame?: () => unknown}).parentFrame?.()
      : undefined;
    if (!uid && parentFrame) {
      throw createToolError(
        ErrorCodes.FRAME_REQUIRED,
        'get_css_styles 仅支持主 frame 中的元素，请先用 select_frame 切回主 frame（index 0）。',
        {toolName: 'get_css_styles', selector},
      );
    }

    const {locator, targetDescription} = resolveTargetLocator(ctx, {
      uid,
      selector,
      toolName: 'get_css_styles',
    });
    const probe = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const element = locator.first();

    try {
      // 1. 通过 locator 定位元素并打上一次性探针属性（只读语义：finally 里移除）。
      await element.evaluate(
        (node, [attr, value]) => {
          node.setAttribute(attr, value);
        },
        [PROBE_ATTR, probe],
      );

      // 2. CDP 侧用探针属性查询 nodeId 并拉取匹配样式。
      const raw = await withCdpSession(page, async client => {
        await client.send('DOM.enable');
        await client.send('CSS.enable');
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
            `元素定位成功但 CDP 查询失败：${targetDescription}`,
            {toolName: 'get_css_styles', selector, uid},
          );
        }
        return (await client.send('CSS.getMatchedStylesForNode', {
          nodeId,
        })) as unknown as RawMatchedStyles;
      });

      const report = formatMatchedStyles(raw, {
        elementSelector: targetDescription,
        pageSize,
        pageIdx,
      });

      response.setStructuredContent({
        success: true,
        message: `Matched ${report.totalRules} CSS rule(s) for ${targetDescription}`,
        tooltype: 'get_css_styles',
        data: report,
      });
      for (const line of renderCssStylesReport(report).split('\n')) {
        response.appendResponseLine(line);
      }
    } catch (error) {
      throw toElementError(error, {
        toolName: 'get_css_styles',
        selector,
        uid,
        target: targetDescription,
      });
    } finally {
      // 3. 清理探针属性（尽力而为；页面/元素已销毁时忽略）。
      try {
        await element.evaluate((node, attr) => {
          node.removeAttribute(attr);
        }, PROBE_ATTR);
      } catch {
        // 元素可能已被移除
      }
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'css',
  description: 'CSS cascade inspection tools.',
  profile: 'workflow',
  tools: [{modulePath: './css.js', handlerName: 'getCssStyles'}],
} satisfies DomainManifest;
