/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {
  browserTimeoutSchema,
  withDebuggerTrapBypass,
  withOperationTimeout,
} from '../shared/browserRuntime.js';
import {
  resolveTargetLocator,
  toElementError,
} from '../shared/elementLocator.js';
import {defineTool} from '../ToolDefinition.js';

const DEFAULT_CLICK_TIMEOUT_MS = 10_000;

/**
 * 点击页面元素，支持单击和双击。支持 uid 与 selector 双模定位。
 */
export const click = defineTool({
  name: 'click',
  description:
    '点击页面元素，支持单击与双击。支持由 take_snapshot 产生的 uid（推荐）或传统定位器（CSS、role=、text=、xpath=）。',
  annotations: {
    title: '点击元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
    requirements: {
      browser: 'connected',
      page: 'selected',
      frame: 'selected',
      debugger: 'running',
    },
  },
  schema: {
    uid: zod
      .string()
      .optional()
      .describe(
        '由 take_snapshot 返回的元素唯一编号，如 "1_4"。推荐优先使用，稳定且免疫动态 Class 混淆。',
      ),
    selector: zod
      .string()
      .optional()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。当未提供 uid 时必填。多匹配时用 >> nth=N 消歧。',
      ),
    dblClick: zod.boolean().optional().describe('是否双击，默认 false。'),
    timeoutMs: browserTimeoutSchema('页面操作超时（毫秒，默认 10000）。'),
  },
  handler: async (request, response, context) => {
    const {
      uid,
      selector,
      dblClick = false,
      timeoutMs = DEFAULT_CLICK_TIMEOUT_MS,
    } = request.params;

    let resolvedDescription = selector || (uid ? `uid=${uid}` : '');

    try {
      const targetDescription = await withDebuggerTrapBypass(
        context,
        async () => {
          const {locator, targetDescription} = resolveTargetLocator(context, {
            uid,
            selector,
            toolName: 'click',
          });
          resolvedDescription = targetDescription;
          await withOperationTimeout(
            locator.click({
              clickCount: dblClick ? 2 : 1,
              timeout: timeoutMs,
            }),
            '点击页面元素',
            timeoutMs,
          );
          return targetDescription;
        },
      );
      response.setStructuredContent({
        success: true,
        message: `Successfully ${dblClick ? 'double ' : ''}clicked on element: ${targetDescription}`,
        tooltype: 'click',
        data: {
          selector,
          ...(uid !== undefined ? {uid} : {}),
          dblClick,
        },
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'click',
        selector,
        uid,
        target: resolvedDescription,
        dblClick,
      });
    }
  },
});
