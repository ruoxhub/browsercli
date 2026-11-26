/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {CaptchaDetector} from '../modules/captcha/index.js';
import {type Page, zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {
  getActivePageWithGuard,
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from './shared/browserRuntime.js';
import {toElementError} from './shared/elementLocator.js';
import {getErrorMessage, sendJson} from './shared/pageResponse.js';
import type {MessagesResult} from './shared/types.js';
import {
  defineBrowserTool,
  definePageTool,
  timeoutSchema,
} from './ToolDefinition.js';

// ─── types.ts ────────────────────────────────────────────

// ─── 运行时服务接口 ──────────────────────────────────

/**
 * Page 运行时服务（从 McpContext 提取的接口）。
 *
 * 纯函数通过此接口访问页面控制和浏览器管理能力，
 * 调用方负责提供具体实现。
 */
export interface PageRuntimeServices {
  /** 获取当前活跃页面的 Puppeteer Page 对象 */
  getActivePage: () => Promise<Page>;
  /** 浏览器是否已连接 */
  isBrowserConnected: () => boolean;
  /** Collector 是否正在运行 */
  isCollectorRunning: () => Promise<boolean>;
}

// ─── 参数类型 ──────────────────────────────────────────

/** waitForElement 参数 */
export interface WaitForElementParams {
  /** 元素定位器（CSS / role= / text= / xpath=） */
  selector: string;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/** scrollBy 参数 */
export interface ScrollByParams {
  /** 滚动方向 */
  direction: 'up' | 'down' | 'top' | 'bottom';
  /** 滚动像素（仅用于 up/down，默认 1000） */
  pixels?: number;
}

/** checkBrowserHealth 参数（无参数） */
export type CheckBrowserHealthParams = object;

// ─── 数据类型 ──────────────────────────────────────────

/** 元素信息 */
export interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  attributes: Record<string, string>;
}

/** waitForElement 返回数据 */
export interface WaitForElementData {
  selector: string;
  appeared: boolean;
  element: ElementInfo | null;
}

/** scrollBy 返回数据 */
export interface ScrollByData {
  direction: string;
  pixels: number;
  result: string;
}

/** 健康检查问题 */
export interface HealthIssue {
  code: string;
  message: string;
}

/** checkBrowserHealth 返回数据 */
export interface CheckBrowserHealthData {
  healthy: boolean;
  connected: boolean;
  pageReady: boolean;
  currentPage: {url: string | null; title: string | null};
  recommendations: string[];
  issues: HealthIssue[];
}

// ─── 结果类型 ──────────────────────────────────────────

/**
 * Page 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface PageResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat: string;
}

/** waitForElement 结果 */
export interface WaitForElementResult extends PageResult<WaitForElementData> {
  tooltype: 'wait_for_element';
}

/** scrollBy 结果 */
export interface ScrollByResult extends PageResult<ScrollByData> {
  tooltype: 'scroll_by';
}

/** checkBrowserHealth 结果 */
export interface CheckBrowserHealthResult extends PageResult<CheckBrowserHealthData> {
  tooltype: 'check_browser_health';
}

// ─── checkBrowserHealth.ts ───────────────────────────────

/**
 * 检查浏览器连接健康状态和页面可用性。
 */
export const checkBrowserHealth = defineBrowserTool({
  name: 'check_browser_health',
  concurrency: 'none',
  description: '检查浏览器连接健康状态与页面可用性。',
  annotations: {
    category: ToolCategory.PAGES,
    readOnlyHint: true,
    requirements: {
      browser: 'connected',
      recovery: true,
    },
  },
  schema: {},
  handler: async (_request, response, context) => {
    const issues: HealthIssue[] = [];
    let connected =
      context.isBrowserConnected?.() ??
      context.getBrowserManager?.()?.getBrowser()?.isConnected() ??
      false;
    try {
      const running =
        (await context.isCollectorRunning?.()) ??
        (await context.getCodeCollector?.()?.getStatus())?.running ??
        false;
      connected = connected || running;
    } catch {
      // Fall through to page-level probes below.
    }

    let pageReady = false;
    let url: string | null = null;
    let title: string | null = null;
    try {
      const page = context.getSelectedPage()
        ? context.getSelectedPage()!
        : await context.getPageController?.()?.getPage();
      if (!page) {
        throw new Error('没有选中的页面');
      }
      pageReady = true;
      connected = true;
      url = page.url();
      title = await withOperationTimeout(page.title(), '读取页面标题');
      await withOperationTimeout(page.evaluate('1+1'), '执行页面健康探针');
      const pageId = context.getPageId(page);
      if (pageId) {
        context.recordPageHealthy?.(pageId);
      }
    } catch (error) {
      const message = normalizeBrowserRuntimeError(error);
      issues.push({
        code: 'NO_ACTIVE_PAGE',
        message: `No controllable active page: ${message}`,
      });
      if (/浏览器连接失败|已关闭|超时/.test(message)) {
        issues.push({
          code: 'PAGE_UNRESPONSIVE',
          message: `Active page is present but not responsive: ${message}`,
        });
      }
    }

    if (!connected) {
      issues.push({
        code: 'BROWSER_DISCONNECTED',
        message:
          'Browser is not connected. Use browserUrl/wsEndpoint or start remote debugging.',
      });
    }

    const data = {
      healthy: issues.length === 0,
      connected,
      pageReady,
      currentPage: {url, title},
      recommendations: [
        !connected
          ? 'Start Chrome with --remote-debugging-port and run "browsercli start --browserUrl http://127.0.0.1:9222".'
          : null,
        connected && !pageReady
          ? 'Open/select a target page, then retry health check.'
          : null,
      ].filter((item): item is string => Boolean(item)),
      issues,
    };

    sendJson(response, {
      success: issues.length === 0,
      message:
        issues.length === 0 ? '浏览器健康' : `发现 ${issues.length} 个问题`,
      tooltype: 'check_browser_health',
      data,
    });
  },
});

// ─── detectCaptcha.ts ────────────────────────────────────

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

export const detectCaptcha = definePageTool({
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
      throw createToolError(ErrorCodes.RUNTIME, safeCaptchaError(error), {
        toolName: 'detect_captcha',
      });
    }
  },
});

// ─── scrollBy.ts ─────────────────────────────────────────

/**
 * 按方向滚动页面。
 */
export const scrollBy = definePageTool({
  name: 'scroll_by',
  description:
    '按方向（up/down/top/bottom）滚动页面，并自动等待 800ms 以触发懒加载内容。',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: true},
  schema: {
    direction: zod.enum(['up', 'down', 'top', 'bottom']).describe('滚动方向。'),
    pixels: zod
      .number()
      .optional()
      .describe('滚动像素（仅 up/down 生效，默认 1000）。'),
  },
  handler: async (request, response, context) => {
    const {direction, pixels = 1000} = request.params;

    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'scroll_by'},
      );
    }

    try {
      const result = await page.evaluate(
        ({dir, px}: {dir: string; px: number}) => {
          switch (dir) {
            case 'top':
              window.scrollTo(0, 0);
              return 'scrolled to top';
            case 'bottom':
              window.scrollTo(0, document.body.scrollHeight);
              return 'scrolled to bottom';
            case 'up':
              window.scrollBy(0, -Math.abs(px));
              return `scrolled up ${Math.abs(px)}px`;
            case 'down':
              window.scrollBy(0, Math.abs(px));
              return `scrolled down ${Math.abs(px)}px`;
            default:
              return 'unknown direction';
          }
        },
        {dir: direction, px: pixels},
      );

      // 等待懒加载触发
      await new Promise(resolve => setTimeout(resolve, 800));

      sendJson(response, {
        success: true,
        message: `页面已滚动: ${direction}`,
        tooltype: 'scroll_by',
        data: {direction, pixels, result},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `滚动页面失败: ${getErrorMessage(error)}`,
        {toolName: 'scroll_by', direction, pixels},
      );
    }
  },
});

// ─── waitFor.ts ──────────────────────────────────────────

/**
 * 等待页面出现指定的任意一段文本，匹配后可附带页面语义快照。
 */
export const waitFor = definePageTool({
  name: 'wait_for',
  description:
    '等待指定文本出现在当前页面中（支持多个候选文本，命中任一即返回）。默认同时匹配隐藏文本；设置 visible=true 仅匹配可见文本。',
  annotations: {
    title: '等待文本出现',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    text: zod
      .array(zod.string())
      .min(1)
      .describe(
        '非空文本数组，任意一项匹配可访问性名称或 DOM 文本子串即完成等待（区分大小写）。',
      ),
    ...timeoutSchema,
    visible: zod
      .boolean()
      .default(false)
      .optional()
      .describe('若为 true，仅当匹配文本元素可见时才算命中，默认 false。'),
    includeSnapshot: zod
      .boolean()
      .optional()
      .describe('命中后是否在响应中附带页面语义快照，默认 true。'),
  },
  handler: async (request, response, context) => {
    const {
      text,
      timeout,
      visible = false,
      includeSnapshot = true,
    } = request.params;

    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'wait_for'},
      );
    }

    try {
      await context.waitForTextOnPage({text, timeout, visible});
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isTimeout = /timed?\s*out/i.test(msg);
      throw createToolError(
        isTimeout ? ErrorCodes.TIMEOUT : ErrorCodes.RUNTIME,
        isTimeout
          ? `${msg}. Text matching is case-sensitive. Try a shorter distinctive substring.`
          : msg,
        {toolName: 'wait_for', text, timeout},
        isTimeout,
      );
    }

    response.appendResponseLine(
      `Element matching one of ${JSON.stringify(text)} found.`,
    );
    if (includeSnapshot) {
      response.includeSnapshot?.();
    }
    response.setStructuredContent({
      success: true,
      message: `Element matching one of ${JSON.stringify(text)} found.`,
      tooltype: 'wait_for',
      data: {text, visible, found: true},
    });
  },
});

// ─── waitForElement.ts ───────────────────────────────────

/**
 * 等待选择器对应的元素出现在页面中。
 */
export const waitForElement = definePageTool({
  name: 'wait_for_element',
  description:
    '等待定位器对应的元素出现在页面中。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: true},
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
    timeout: zod
      .number()
      .optional()
      .describe('最长等待时间（毫秒，默认 30000）。'),
  },
  handler: async (request, response, context) => {
    const {selector, timeout} = request.params;

    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'wait_for_element'},
      );
    }

    try {
      await page.locator(selector).waitFor({
        state: 'visible',
        timeout: timeout ?? 30000,
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'wait_for_element',
        selector,
        timeout: timeout ?? 30000,
      });
    }

    const element = await page
      .locator(selector)
      .first()
      .evaluate((el: Element) => {
        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          textContent: el.textContent?.trim().substring(0, 100) || undefined,
          attributes: Array.from(el.attributes).reduce(
            (acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            },
            {} as Record<string, string>,
          ),
        };
      })
      .catch(() => null);

    sendJson(response, {
      success: true,
      message: `元素已出现: ${selector}`,
      tooltype: 'wait_for_element',
      data: {selector, appeared: true, element},
    });
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'page',
  description: 'Page interaction and state tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './page.js', handlerName: 'waitForElement'},
    {modulePath: './page.js', handlerName: 'waitFor'},
    {modulePath: './page.js', handlerName: 'scrollBy'},
    {
      modulePath: './page.js',
      handlerName: 'checkBrowserHealth',
      requirements: {
        browser: 'connected',
        recovery: true,
      },
    },
    {modulePath: './page.js', handlerName: 'detectCaptcha'},
  ],
} satisfies DomainManifest;
