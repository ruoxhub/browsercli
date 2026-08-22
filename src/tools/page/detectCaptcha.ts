/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {CaptchaDetector} from '../../modules/captcha/index.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {normalizeBrowserRuntimeError} from '../shared/browserRuntime.js';
import {sendJson} from '../shared/pageResponse.js';
import {defineTool} from '../ToolDefinition.js';

const detector = new CaptchaDetector();

function safeCaptchaError(error: unknown): string {
  const normalized = normalizeBrowserRuntimeError(error);
  if (/浏览器连接失败/.test(normalized)) {
    return '浏览器连接失败，页面或 CDP 会话可能已失效。';
  }
  if (/已关闭/.test(normalized)) {
    return '当前页面、上下文或浏览器已关闭。';
  }
  if (/执行上下文已销毁/.test(normalized)) {
    return '页面刚发生导航，执行上下文已销毁。';
  }
  if (/timed out|超时/i.test(normalized)) {
    return 'CAPTCHA 页面评估超时。';
  }
  return '无法读取当前页面的 CAPTCHA 状态。';
}

export const detectCaptcha = defineTool({
  name: 'detect_captcha',
  description:
    '只读评估当前页面是否存在 CAPTCHA，并可等待挑战稳定清除；不会自动求解或操作页面。',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: true},
  schema: {
    action: zod
      .enum(['detect', 'wait_for_clear'])
      .default('detect')
      .describe('detect 立即评估；wait_for_clear 等待挑战稳定清除。'),
    timeout: zod
      .number()
      .int()
      .min(1000)
      .max(300000)
      .optional()
      .describe('wait_for_clear 的最长等待时间（毫秒，默认 300000）。'),
  },
  handler: async (request, response, context) => {
    const {action, timeout} = request.params;
    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'detect_captcha'},
      );
    }
    try {
      if (action === 'wait_for_clear') {
        const result = await detector.waitForClear(page, timeout);
        sendJson(response, {
          success: true,
          message: result.cleared
            ? 'CAPTCHA 已稳定清除。'
            : '等待超时，CAPTCHA 尚未稳定清除。',
          tooltype: 'detect_captcha',
          data: {
            action,
            assessment: result.assessment,
            wait: {
              cleared: result.cleared,
              elapsedMs: result.elapsedMs,
              checks: result.checks,
            },
          },
        });
        return;
      }

      const assessment = await detector.assess(page);
      sendJson(response, {
        success: true,
        message: 'CAPTCHA 页面评估完成。',
        tooltype: 'detect_captcha',
        data: {action, assessment},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        safeCaptchaError(error),
        {toolName: 'detect_captcha'},
      );
    }
  },
});
