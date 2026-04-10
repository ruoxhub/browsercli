/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {URL} from 'node:url';

import {logger} from '../logger.js';
import {puppeteer} from '../third_party/index.js';
import type {Browser, Page} from '../third_party/index.js';

const DEFAULT_PORT = parseInt(process.env.CDP_PROXY_PORT || '3456');

/**
 * CDP Proxy - 通过 HTTP API 操控 Chrome DevTools Protocol
 *
 * 支持两种模式：
 * 1. 使用现有 Browser 实例（集成到 MCP 服务器）
 * 2. 独立 HTTP 服务器模式（standalone）
 */
export class CdpProxy {
  private server?: http.Server;
  private browser?: Browser;
  private port: number;
  private readonly sessions = new Map<string, number>(); // targetId -> sessionId
  private cmdId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (msg: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
  }

  /**
   * 使用现有 Browser 实例初始化
   */
  async initializeWithBrowser(browser: Browser): Promise<void> {
    this.browser = browser;
    logger(`[CdpProxy] 已使用现有 Browser 实例初始化`);
  }

  /**
   * 启动独立 HTTP 服务器（需要单独连接 Browser）
   */
  async connectToBrowser(browserURL: string): Promise<void> {
    try {
      this.browser = await puppeteer.connect({
        browserURL,
        defaultViewport: null,
      });
      logger(`[CdpProxy] 已连接到浏览器：${browserURL}`);
    } catch (error) {
      throw new Error(`连接浏览器失败：${(error as Error).message}`);
    }
  }

  /**
   * 启动 HTTP 服务器
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const parsed = new URL(req.url!, `http://localhost:${this.port}`);
        const pathname = parsed.pathname;
        const query = Object.fromEntries(parsed.searchParams);

        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        try {
          await this.handleRequest(req, res, pathname, query);
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({error: (error as Error).message}));
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        logger(`[CdpProxy] 运行在 http://localhost:${this.port}`);
        resolve();
      });

      this.server.on('error', err => {
        logger(`[CdpProxy] 服务器错误:`, err);
        reject(err);
      });
    });
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    query: Record<string, string>,
  ): Promise<void> {
    // GET /health - 健康检查（不需要 browser）
    if (pathname === '/health') {
      res.end(
        JSON.stringify({
          status: 'ok',
          port: this.port,
          sessions: this.sessions.size,
        }),
      );
      return;
    }

    if (!this.browser) {
      throw new Error('CDP Proxy 未连接到浏览器');
    }

    // GET /targets - 列出所有页面
    if (pathname === '/targets') {
      const targets = await this.browser.targets();
      const pages = targets
        .filter(t => t.type() === 'page')
        .map(t => ({
          targetId: (t as unknown as {targetId: string}).targetId,
          title: t.url(),
          url: t.url(),
          type: t.type(),
        }));
      res.end(JSON.stringify(pages, null, 2));
      return;
    }

    // GET /new?url=xxx - 创建新后台 tab
    if (pathname === '/new') {
      const targetUrl = query.url || 'about:blank';
      const page = await this.browser.newPage();
      if (targetUrl !== 'about:blank') {
        await page.goto(targetUrl, {waitUntil: 'domcontentloaded'});
      }
      const target = page.target();
      res.end(
        JSON.stringify({
          targetId: (target as unknown as {targetId: string}).targetId,
        }),
      );
      return;
    }

    // GET /close?target=xxx - 关闭 tab
    if (pathname === '/close') {
      const target = this.browser
        .targets()
        .find(
          t => (t as unknown as {targetId: string}).targetId === query.target,
        );
      if (target) {
        const page = await target.page();
        await page?.close({runBeforeUnload: false});
      }
      res.end(JSON.stringify({ok: true}));
      return;
    }

    // GET /navigate?target=xxx&url=yyy - 导航
    if (pathname === '/navigate') {
      const page = await this.getPageByTargetId(query.target);
      await page.goto(query.url, {waitUntil: 'domcontentloaded'});
      res.end(JSON.stringify({ok: true, url: page.url()}));
      return;
    }

    // GET /back?target=xxx - 后退
    if (pathname === '/back') {
      const page = await this.getPageByTargetId(query.target);
      await page.evaluate(() => history.back());
      await page.waitForNavigation({waitUntil: 'domcontentloaded'});
      res.end(JSON.stringify({ok: true}));
      return;
    }

    // GET /info?target=xxx - 页面信息
    if (pathname === '/info') {
      const page = await this.getPageByTargetId(query.target);
      const info = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        ready: document.readyState,
      }));
      res.end(JSON.stringify(info));
      return;
    }

    // POST /eval?target=xxx - 执行 JS
    if (pathname === '/eval') {
      const page = await this.getPageByTargetId(query.target);
      const body = await this.readBody(req);
      const expr = body || query.expr || 'document.title';
      const result = await page.evaluate(expr);
      res.end(JSON.stringify({value: result}));
      return;
    }

    // POST /click?target=xxx - 点击（JS click）
    if (pathname === '/click') {
      const page = await this.getPageByTargetId(query.target);
      const selector = await this.readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({error: 'POST body 需要 CSS 选择器'}));
        return;
      }
      const result = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return {error: '未找到元素：' + sel};
        (el as HTMLElement).scrollIntoView({block: 'center'});
        (el as HTMLElement).click();
        return {
          clicked: true,
          tag: (el as HTMLElement).tagName,
          text: (el.textContent || '').slice(0, 100),
        };
      }, selector);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /clickAt?target=xxx - 真实鼠标点击（CDP Input）
    if (pathname === '/clickAt') {
      const page = await this.getPageByTargetId(query.target);
      const selector = await this.readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({error: 'POST body 需要 CSS 选择器'}));
        return;
      }
      const coord = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return {error: '未找到元素：' + sel};
        (el as HTMLElement).scrollIntoView({block: 'center'});
        const rect = (el as HTMLElement).getBoundingClientRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          tag: (el as HTMLElement).tagName,
        };
      }, selector);
      if ((coord as {error?: string}).error) {
        res.statusCode = 400;
        res.end(JSON.stringify(coord));
        return;
      }
      const {x, y} = coord as {x: number; y: number};
      await page.mouse.click(x, y);
      res.end(JSON.stringify({clicked: true, x, y}));
      return;
    }

    // POST /setFiles?target=xxx - 文件上传
    if (pathname === '/setFiles') {
      const page = await this.getPageByTargetId(query.target);
      const body = JSON.parse(await this.readBody(req));
      if (!body.selector || !body.files) {
        res.statusCode = 400;
        res.end(JSON.stringify({error: '需要 selector 和 files 字段'}));
        return;
      }
      const input = await page.$(body.selector);
      if (!input) {
        res.statusCode = 400;
        res.end(JSON.stringify({error: '未找到元素：' + body.selector}));
        return;
      }
      await (
        input as unknown as {uploadFile: (...files: string[]) => Promise<void>}
      ).uploadFile(...body.files);
      res.end(JSON.stringify({success: true, files: body.files.length}));
      return;
    }

    // GET /scroll?target=xxx&y=3000&direction=down - 滚动
    if (pathname === '/scroll') {
      const page = await this.getPageByTargetId(query.target);
      const y = parseInt(query.y || '3000');
      const direction = query.direction || 'down';
      let js: string;
      if (direction === 'top') {
        js = 'window.scrollTo(0, 0); "scrolled to top"';
      } else if (direction === 'bottom') {
        js =
          'window.scrollTo(0, document.body.scrollHeight); "scrolled to bottom"';
      } else if (direction === 'up') {
        js = `window.scrollBy(0, -${Math.abs(y)}); "scrolled up ${Math.abs(y)}px"`;
      } else {
        js = `window.scrollBy(0, ${Math.abs(y)}); "scrolled down ${Math.abs(y)}px"`;
      }
      await page.evaluate(js);
      await new Promise(r => setTimeout(r, 800));
      res.end(JSON.stringify({scrolled: true}));
      return;
    }

    // GET /screenshot?target=xxx&file=/tmp/x.png - 截图
    if (pathname === '/screenshot') {
      const page = await this.getPageByTargetId(query.target);
      const format = (query.format || 'png') as 'png' | 'jpeg' | 'webp';
      const screenshot = await page.screenshot({
        type: format,
        quality: format === 'jpeg' ? 80 : undefined,
        fullPage: query.fullPage === 'true',
      });
      if (query.file) {
        fs.writeFileSync(query.file, screenshot);
        res.end(JSON.stringify({saved: query.file}));
      } else {
        res.setHeader('Content-Type', `image/${format}`);
        res.end(screenshot);
      }
      return;
    }

    // 404 - 未知端点
    res.statusCode = 404;
    res.end(
      JSON.stringify({
        error: '未知端点',
        endpoints: {
          '/health': 'GET - 健康检查',
          '/targets': 'GET - 列出所有页面',
          '/new?url=': 'GET - 创建后台 tab',
          '/close?target=': 'GET - 关闭 tab',
          '/navigate?target=&url=': 'GET - 导航',
          '/back?target=': 'GET - 后退',
          '/info?target=': 'GET - 页面信息',
          '/eval?target=': 'POST body=JS - 执行 JS',
          '/click?target=': 'POST body=CSS 选择器 - 点击',
          '/clickAt?target=': 'POST body=CSS 选择器 - 鼠标点击',
          '/setFiles?target=': 'POST body=JSON - 文件上传',
          '/scroll?target=&y=&direction=': 'GET - 滚动',
          '/screenshot?target=&file=': 'GET - 截图',
        },
      }),
    );
  }

  /**
   * 根据 targetId 获取 Page 实例
   */
  private async getPageByTargetId(targetId: string): Promise<Page> {
    if (!this.browser) {
      throw new Error('Browser 未初始化');
    }
    const target = this.browser
      .targets()
      .find(t => (t as unknown as {targetId: string}).targetId === targetId);
    if (!target) {
      throw new Error(`未找到 target: ${targetId}`);
    }
    const page = await target.page();
    if (!page) {
      throw new Error(`target 没有关联 page: ${targetId}`);
    }
    return page;
  }

  /**
   * 读取 POST body
   */
  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise(resolve => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        resolve(body);
      });
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }
    if (this.browser) {
      await this.browser.disconnect();
      this.browser = undefined;
    }
    this.sessions.clear();
    logger('[CdpProxy] 已停止');
  }
}
