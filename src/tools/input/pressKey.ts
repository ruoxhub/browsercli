/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {parseKey} from '../../utils/keyboard.js';

/**
 * 按下键盘按键或组合键。
 */
export const pressKey = defineTool({
  name: 'press_key',
  description:
    'Press a keyboard key or key combination (e.g. "Enter", "Control+A", "Alt+Shift+F"). Supports modifier keys.',
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
      response.setStructuredContent({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        tooltype: 'press_key',
        data: {key},
      });
    }
  },
});
