/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {parseKey} from '../../utils/keyboard.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 按下键盘按键或组合键。
 */
export const pressKey = defineTool({
  name: 'press_key',
  description:
    '按下键盘按键或组合键（如 "Enter"、"Control+A"、"Alt+Shift+F"），支持修饰键。',
  annotations: {
    title: '按键',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    key: zod.string().describe('按键或组合键，如 "Enter", "Control+A"。'),
  },
  handler: async (request, response, context) => {
    const {key} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      const tokens = parseKey(key);
      const [mainKey, ...modifiers] = tokens;

      for (const modifier of modifiers) {
        await page.keyboard.down(modifier);
      }
      await page.keyboard.press(mainKey);
      for (const modifier of modifiers.toReversed()) {
        await page.keyboard.up(modifier);
      }

      response.setStructuredContent({
        success: true,
        message: `Successfully pressed key: ${key}`,
        tooltype: 'press_key',
        data: {key, mainKey, modifiers},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'press_key', key},
      );
    }
  },
});
