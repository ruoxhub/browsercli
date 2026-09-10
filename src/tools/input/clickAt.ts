/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 通过 CDP 在元素坐标处派发真实鼠标点击事件。
 */
export const clickAt = defineTool({
  name: 'click_at',
  description:
    '使用 CDP Input.dispatchMouseEvent 在元素中心坐标处派发真实鼠标点击事件，适用于 Playwright 点击被拦截的场景。',
  annotations: {
    title: '坐标点击',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
  },
  handler: async (request, response, context) => {
    const {selector} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      const coords = await frame.locator(selector).evaluate((el: Element) => {
        el.scrollIntoView({block: 'center'});
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          tag: el.tagName,
          text: (el.textContent || '').slice(0, 100),
        };
      });

      await withCdpSession(page, async client => {
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
      });

      response.setStructuredContent({
        success: true,
        message: `Real mouse click at ${selector} (${coords.x}, ${coords.y})`,
        tooltype: 'click_at',
        data: coords,
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'click_at', selector});
    }
  },
});
