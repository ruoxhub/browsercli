/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {resolveClickPoint} from '../../modules/browser/clickPoint.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 通过 CDP 在元素坐标处派发真实鼠标点击事件。
 *
 * 全定位器（CSS / role= / text= / xpath= / >> nth=）均通过 CDP quad 选取视口内可见区域中心；
 * 并在点击前先滚动入视口以防点偏。
 */
export const clickAt = defineTool({
  name: 'click_at',
  description:
    '使用 CDP Input.dispatchMouseEvent 在元素中心坐标处派发真实鼠标点击事件，适用于 Playwright 点击被拦截的场景。会选取元素在视口内的最大可见区域中心。',
  annotations: {
    title: '坐标点击',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。',
      ),
  },
  handler: async (request, response, context) => {
    const {selector} = request.params;
    const frame = (context as Context).getSelectedFrame();

    try {
      const resolution = await resolveClickPoint(frame, selector);

      if (resolution.kind === 'jsClick') {
        await frame.locator(selector).click();
        response.setStructuredContent({
          success: true,
          message: `JS fallback click at ${selector}`,
          tooltype: 'click_at',
          data: {x: 0, y: 0, tag: '', text: '', source: 'jsClick'},
        });
        return;
      }

      await withCdpSession(frame.page(), async client => {
        await client.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: resolution.x,
          y: resolution.y,
          button: 'left',
          clickCount: 1,
        });
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: resolution.x,
          y: resolution.y,
          button: 'left',
          clickCount: 1,
        });
      });

      response.setStructuredContent({
        success: true,
        message: `Real mouse click at ${selector} (${resolution.x}, ${resolution.y}) via ${resolution.source}`,
        tooltype: 'click_at',
        data: {
          x: resolution.x,
          y: resolution.y,
          tag: '',
          text: '',
          source: resolution.source,
          quadCount: resolution.quadCount,
        },
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'click_at', selector});
    }
  },
});
