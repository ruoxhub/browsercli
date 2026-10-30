/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {
  browserTimeoutSchema,
  withDebuggerTrapBypass,
} from '../shared/browserRuntime.js';
import {
  resolveTargetLocator,
  toElementError,
} from '../shared/elementLocator.js';
import {defineTool} from '../ToolDefinition.js';

import {fillTargetLocator} from './fillElement.js';

/**
 * 在 input/textarea/select 元素中填入值。支持 uid 与 selector 双模定位。
 */
export const fill = defineTool({
  name: 'fill',
  description:
    '向输入元素填入值，<select> 会通过 selectOption 自动处理。支持由 take_snapshot 产生的 uid（推荐）或传统定位器（CSS、role=、text=、xpath=）。',
  annotations: {
    title: '填充输入',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
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
    value: zod.string().describe('填充值。'),
    timeoutMs: browserTimeoutSchema('单次页面操作超时（毫秒，默认 10000）。'),
  },
  handler: async (request, response, context) => {
    const {uid, selector, timeoutMs, value} = request.params;
    let resolvedDescription = selector || (uid ? `uid=${uid}` : '');

    try {
      const {found, isSelect, targetDescription} = await withDebuggerTrapBypass(
        context,
        async () => {
          const {locator, targetDescription} = resolveTargetLocator(context, {
            uid,
            selector,
            toolName: 'fill',
          });
          resolvedDescription = targetDescription;
          const result = await fillTargetLocator(locator, value, timeoutMs);
          return {...result, targetDescription};
        },
      );

      if (!found) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `Element not found: ${targetDescription}`,
          {toolName: 'fill', selector, uid, target: targetDescription},
        );
      }

      response.setStructuredContent({
        success: true,
        message: `Successfully filled value into element: ${targetDescription}`,
        tooltype: 'fill',
        data: {
          selector,
          ...(uid !== undefined ? {uid} : {}),
          value,
          isSelect,
        },
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'fill',
        selector,
        uid,
        target: resolvedDescription,
        value,
      });
    }
  },
});
