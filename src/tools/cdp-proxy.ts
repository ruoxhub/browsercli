/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';
import type {Page} from '../third_party/index.js';
import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';
import {CdpProxy} from '../cdp-proxy/index.js';

let proxyInstance: CdpProxy | null = null;

/**
 * 启动 CDP Proxy 服务器
 */
export const cdp_start_proxy = defineTool({
  name: 'cdp_start_proxy',
  description: '启动 CDP Proxy HTTP 服务器，允许通过 HTTP API 操控浏览器。代理运行在 localhost:3456。',
  annotations: {
    category: ToolCategory.PAGES,
    readOnlyHint: false,
  },
  schema: {
    port: zod.number().optional().describe('HTTP 端口，默认 3456'),
  },
  handler: async (request, response) => {
    if (proxyInstance) {
      response.appendResponseLine('CDP Proxy 已经在运行中');
      return;
    }

    const port = request.params.port || 3456;
    proxyInstance = new CdpProxy(port);

    try {
      // 注意：proxy 需要 browser 实例，这里先启动 HTTP 服务器
      // browser 实例会在后续通过 MCP context 注入
      await proxyInstance.start();
      response.appendResponseLine(`CDP Proxy 已启动在 http://localhost:${port}`);
      response.appendResponseLine('可用端点：/health, /targets, /new, /close, /navigate, /eval, /click, /screenshot 等');
    } catch (error) {
      response.appendResponseLine(`启动失败：${(error as Error).message}`);
    }
  },
});

/**
 * 获取所有页面列表
 */
export const cdp_get_targets = defineTool({
  name: 'cdp_get_targets',
  description: '获取所有可用的页面 target 列表',
  annotations: {
    category: ToolCategory.PAGES,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const pages = context.getPages();
    const targets = pages.map((page: Page, idx: number) => ({
      index: idx,
      targetId: `page-${idx}`,
      url: page.url(),
      title: 'N/A',
    }));
    response.appendResponseLine('## 可用页面');
    response.appendResponseLine(JSON.stringify(targets, null, 2));
  },
});

/**
 * 创建新页面
 */
export const cdp_new_page = defineTool({
  name: 'cdp_new_page',
  description: '创建一个新的后台页面',
  annotations: {
    category: ToolCategory.PAGES,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().optional().describe('初始 URL，默认 about:blank'),
  },
  handler: async (request, response, context) => {
    const page = await context.newPage();
    if (request.params.url && request.params.url !== 'about:blank') {
      await page.goto(request.params.url, {waitUntil: 'domcontentloaded'});
    }
    response.appendResponseLine(`新页面已创建：${page.url()}`);
  },
});

/**
 * 关闭页面
 */
export const cdp_close_page = defineTool({
  name: 'cdp_close_page',
  description: '关闭指定的页面',
  annotations: {
    category: ToolCategory.PAGES,
    readOnlyHint: false,
  },
  schema: {
    pageIdx: zod.number().describe('页面索引（从 get_targets 获取）'),
  },
  handler: async (request, response, context) => {
    await context.closePage(request.params.pageIdx);
    response.appendResponseLine(`页面 ${request.params.pageIdx} 已关闭`);
  },
});

/**
 * 页面导航
 */
export const cdp_navigate = defineTool({
  name: 'cdp_navigate',
  description: '在当前选中的页面中导航到指定 URL',
  annotations: {
    category: ToolCategory.PAGES,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().describe('目标 URL'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    await page.goto(request.params.url, {waitUntil: 'domcontentloaded'});
    response.appendResponseLine(`已导航到：${page.url()}`);
  },
});

/**
 * 执行 JavaScript
 */
export const cdp_eval = defineTool({
  name: 'cdp_eval',
  description: '在当前选中的页面中执行 JavaScript 表达式',
  annotations: {
    category: ToolCategory.DOM,
    readOnlyHint: false,
  },
  schema: {
    expr: zod.string().describe('JavaScript 表达式'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const result = await page.evaluate(request.params.expr);
    response.appendResponseLine('## 执行结果');
    response.appendResponseLine(JSON.stringify(result, null, 2));
  },
});

/**
 * 点击元素
 */
export const cdp_click = defineTool({
  name: 'cdp_click',
  description: '点击当前选中页面中的元素（JS click）',
  annotations: {
    category: ToolCategory.DOM,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS 选择器'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const result = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return {error: '未找到元素：' + sel};
      (el as HTMLElement).scrollIntoView({block: 'center'});
      (el as HTMLElement).click();
      return {clicked: true, tag: (el as HTMLElement).tagName};
    }, request.params.selector);
    response.appendResponseLine(JSON.stringify(result));
  },
});

/**
 * 真实鼠标点击
 */
export const cdp_click_at = defineTool({
  name: 'cdp_click_at',
  description: '使用真实鼠标事件点击元素（可触发文件对话框等）',
  annotations: {
    category: ToolCategory.DOM,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS 选择器'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const coord = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return {error: '未找到元素：' + sel};
      (el as HTMLElement).scrollIntoView({block: 'center'});
      const rect = (el as HTMLElement).getBoundingClientRect();
      return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: (el as HTMLElement).tagName};
    }, request.params.selector);
    if ((coord as {error?: string}).error) {
      response.appendResponseLine(JSON.stringify(coord));
      return;
    }
    const {x, y} = coord as {x: number; y: number};
    await page.mouse.click(x, y);
    response.appendResponseLine(`已点击坐标 (${x}, ${y})`);
  },
});

/**
 * 截图
 */
export const cdp_screenshot = defineTool({
  name: 'cdp_screenshot',
  description: '对当前选中的页面截图',
  annotations: {
    category: ToolCategory.SCREENSHOT,
    readOnlyHint: true,
  },
  schema: {
    file: zod.string().optional().describe('保存文件路径，不指定则返回数据'),
    type: zod.enum(['png', 'jpeg', 'webp']).optional().describe('图片类型，默认 png'),
    fullPage: zod.boolean().optional().describe('是否截取整个页面，默认 false'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const type = request.params.type || 'png';
    const fullPage = request.params.fullPage || false;

    const screenshot = await page.screenshot({
      type,
      quality: type === 'jpeg' ? 80 : undefined,
      fullPage,
    });

    if (request.params.file) {
      const fs = await import('node:fs');
      fs.writeFileSync(request.params.file, screenshot);
      response.appendResponseLine(`截图已保存到：${request.params.file}`);
    } else {
      response.appendResponseLine(`截图数据 (${type}, ${screenshot.length} bytes)`);
    }
  },
});

/**
 * 滚动页面
 */
export const cdp_scroll = defineTool({
  name: 'cdp_scroll',
  description: '滚动当前选中的页面',
  annotations: {
    category: ToolCategory.DOM,
    readOnlyHint: false,
  },
  schema: {
    y: zod.number().optional().describe('滚动距离，默认 3000'),
    direction: zod.enum(['down', 'up', 'top', 'bottom']).optional().describe('滚动方向，默认 down'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const y = request.params.y || 3000;
    const direction = request.params.direction || 'down';

    let js: string;
    if (direction === 'top') {
      js = 'window.scrollTo(0, 0);';
    } else if (direction === 'bottom') {
      js = 'window.scrollTo(0, document.body.scrollHeight);';
    } else if (direction === 'up') {
      js = `window.scrollBy(0, -${Math.abs(y)});`;
    } else {
      js = `window.scrollBy(0, ${Math.abs(y)});`;
    }

    await page.evaluate(js);
    await new Promise(r => setTimeout(r, 800));
    response.appendResponseLine(`已${direction}滚动 ${y}px`);
  },
});

/**
 * 上传文件
 */
export const cdp_upload_files = defineTool({
  name: 'cdp_upload_files',
  description: '向文件输入框上传文件',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('文件输入框的 CSS 选择器'),
    files: zod.array(zod.string()).describe('本地文件路径列表'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const input = await page.$(request.params.selector);
    if (!input) {
      response.appendResponseLine(`未找到元素：${request.params.selector}`);
      return;
    }
    await (input as unknown as {uploadFile: (...files: string[]) => Promise<void>}).uploadFile(...request.params.files);
    response.appendResponseLine(`已上传 ${request.params.files.length} 个文件`);
  },
});

/**
 * 获取页面信息
 */
export const cdp_page_info = defineTool({
  name: 'cdp_page_info',
  description: '获取当前选中页面的基本信息',
  annotations: {
    category: ToolCategory.PAGES,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const page = context.getSelectedPage();
    const info = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      ready: document.readyState,
    }));
    response.appendResponseLine('## 页面信息');
    response.appendResponseLine(JSON.stringify(info, null, 2));
  },
});
