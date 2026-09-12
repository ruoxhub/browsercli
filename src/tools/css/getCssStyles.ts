/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  formatMatchedStyles,
  renderCssStylesReport,
} from '../../formatters/cssFormatter.js';
import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const PROBE_ATTR = 'data-pcli-css-probe';

/**
 * 获取元素匹配的 CSS 规则与层叠信息。
 *
 * 通过 locator 解析元素（支持 CSS/role=/text=/xpath=），注入一次性探针
 * 属性把元素桥接到 CDP CSS 域，再用 CSS.getMatchedStylesForNode 拉取
 * 完整层叠数据并格式化为 active/overloaded 报告。
 */
export const getCssStyles = defineTool({
  name: 'get_css_styles',
  description:
    '获取指定元素匹配的 CSS 规则、内联样式、伪元素与继承样式及层叠（cascade）信息，标注每个声明是生效（active）还是被覆盖（overloaded）。常用于排查元素隐藏/反爬样式与样式覆盖冲突。支持分页。',
  annotations: {
    title: '获取CSS层叠样式',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '目标元素的定位器（支持 CSS、role=、text=、xpath=；多匹配时用 >> nth=N 消歧）。',
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
    const {selector, pageSize, pageIdx} = request.params;
    const frame = (context as Context).getSelectedFrame();
    if (!frame) {
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'get_css_styles',
      });
    }
    const page = frame.page();

    const probe = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    try {
      // 1. 通过 locator 定位元素并打上一次性探针属性（只读语义：finally 里移除）。
      const element = frame.locator(selector).first();
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
            `元素定位成功但 CDP 查询失败：${selector}`,
            {toolName: 'get_css_styles', selector},
          );
        }
        return (await client.send('CSS.getMatchedStylesForNode', {
          nodeId,
        })) as never;
      });

      const report = formatMatchedStyles(raw, {
        elementSelector: selector,
        pageSize,
        pageIdx,
      });

      response.setStructuredContent({
        success: true,
        message: `Matched ${report.totalRules} CSS rule(s) for ${selector}`,
        tooltype: 'get_css_styles',
        data: report,
      });
      for (const line of renderCssStylesReport(report).split('\n')) {
        response.appendResponseLine(line);
      }
    } catch (error) {
      throw toElementError(error, {toolName: 'get_css_styles', selector});
    } finally {
      // 3. 清理探针属性（尽力而为；页面/元素已销毁时忽略）。
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
