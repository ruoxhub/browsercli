/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

/**
 * 通过 CDP 在元素坐标处派发真实鼠标点击事件。
 */
export const clickAt = defineTool({
  name: 'click_at',
  description:
    'Perform a real mouse click at the center coordinates of an element using CDP Input.dispatchMouseEvent. Useful when Playwright click is intercepted.',
  annotations: {
    title: '坐标点击',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS 选择器。'),
  },
  handler: async (request, response, context) => {
    const {selector} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      const client = await page.context().newCDPSession(page);

      const coords = await page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`Element not found: ${sel}`);
        el.scrollIntoView({block: 'center'});
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          tag: el.tagName,
          text: (el.textContent || '').slice(0, 100),
        };
      }, selector);

      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: coords.x,
        y: coords.y,
        button: 'left',
        clickCount: 1,
      });

      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: coords.x,
        y: coords.y,
        button: 'left',
        clickCount: 1,
      });

      const result = {
        success: true,
        message: `Real mouse click at ${selector} (${coords.x}, ${coords.y})`,
        tooltype: 'click_at',
        logFormat: 'json',
        data: coords,
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `ClickAt failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'click_at',
        data: {x: 0, y: 0, tag: '', text: ''},
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});
