/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {
  resolveTargetLocator,
  toElementError,
} from '../shared/elementLocator.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 将鼠标悬停在指定元素上。支持 uid 与 selector 双模定位。
 */
export const hover = defineTool({
  name: 'hover',
  description:
    '将鼠标悬停在指定元素上。支持由 take_snapshot 产生的 uid（推荐）或传统定位器（CSS、role=、text=、xpath=）。',
  annotations: {
    title: '悬停元素',
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
  },
  handler: async (request, response, context) => {
    const {uid, selector} = request.params;
    let resolvedDescription = selector || (uid ? `uid=${uid}` : '');

    try {
      const {locator, targetDescription} = resolveTargetLocator(context, {
        uid,
        selector,
        toolName: 'hover',
      });
      resolvedDescription = targetDescription;

      await locator.hover();
      response.setStructuredContent({
        success: true,
        message: `Successfully hovered over element: ${targetDescription}`,
        tooltype: 'hover',
        data: {
          selector,
          ...(uid !== undefined ? {uid} : {}),
        },
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'hover',
        selector,
        uid,
        target: resolvedDescription,
      });
    }
  },
});
