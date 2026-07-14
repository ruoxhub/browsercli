/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * CDP network monitor — 管理 CDP 会话并捕获网络响应。
 *
 * 提取自 CodeCollector.ts。负责：
 * - 创建并管理 CDPSession 生命周期（attach / detach）
 * - 启用 Network + Runtime 域
 * - 注册 Network.responseReceived 监听器并执行响应抓取逻辑
 * - 带超时保护的 Network.getResponseBody 调用
 * - 单文件大小截断 + 去重（通过 CollectedFileRegistry）
 *
 * 该模块持有 CDP 相关状态与抓取逻辑，但不持有文件缓存（委托给 registry）。
 */

import type {CDPSession, Page} from '../../third_party/index.js';
import type {CodeFile} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

import type {CollectedFileRegistry} from './CollectedFileRegistry.js';

/**
 * 低级 CDP 事件回调（原始 params）。
 * 仅在调用方需要自定义处理时使用；默认抓取逻辑内置在 CdpNetworkMonitor 中。
 */
export type CdpResponseHandler = (params: any) => void;

/**
 * CDP 网络监控器。封装 CDP 会话的 attach/detach 与响应体获取，
 * 并内置 Script 类型响应的抓取与截断逻辑。
 */
export class CdpNetworkMonitor {
  private cdpSession: CDPSession | null = null;
  private cdpListeners: {
    responseReceived?: CdpResponseHandler;
  } = {};

  /** 获取响应体的超时时间（毫秒） */
  readonly RESPONSE_BODY_TIMEOUT_MS: number;

  constructor(responseBodyTimeoutMs = 3000) {
    this.RESPONSE_BODY_TIMEOUT_MS = responseBodyTimeoutMs;
  }

  /**
   * 创建 CDP 会话并绑定网络响应抓取逻辑。
   *
   * 监听器必须在 page.goto 之前注册，否则会漏掉导航期间的响应。
   * 抓取到的文件会写入 `files` 数组（闭包捕获）并同步到 `registry`。
   *
   * @param page 目标页面
   * @param files 调用方维护的文件数组，新抓取的文件会 push 进去
   * @param registry 文件缓存注册表，用于去重与缓存
   */
  async attach(
    page: Page,
    files: CodeFile[],
    registry: CollectedFileRegistry,
  ): Promise<void> {
    // ✅ 修复：Playwright - create CDP session via context
    this.cdpSession = await page.context().newCDPSession(page);
    await this.cdpSession.send('Network.enable');
    await this.cdpSession.send('Runtime.enable');

    // ✅ 修复：保存监听器引用，便于移除
    this.cdpListeners.responseReceived = this.createCaptureHandler(
      files,
      registry,
    );
    this.cdpSession.on(
      'Network.responseReceived',
      this.cdpListeners.responseReceived,
    );
  }

  /**
   * 移除监听器并 detach CDP 会话。在 finally 块中调用以保证资源释放。
   */
  async detach(): Promise<void> {
    if (!this.cdpSession) {
      return;
    }
    try {
      // 先移除监听器
      if (this.cdpListeners.responseReceived) {
        this.cdpSession.off(
          'Network.responseReceived',
          this.cdpListeners.responseReceived,
        );
      }
      // 再 detach
      await this.cdpSession.detach();
    } catch (cleanupError) {
      logger.warn('Failed to cleanup CDP session', cleanupError);
    } finally {
      this.cdpSession = null;
      this.cdpListeners = {};
    }
  }

  /**
   * CDP 会话是否处于活动状态。
   */
  isActive(): boolean {
    return this.cdpSession !== null;
  }

  /**
   * 获取当前 CDP 会话（可能为 null）。
   */
  getSession(): CDPSession | null {
    return this.cdpSession;
  }

  /**
   * 获取网络响应体，带超时保护。
   *
   * @throws 当 CDP 会话不可用或超时抛出 Error
   */
  async getResponseBody(
    requestId: string,
  ): Promise<{body: string; base64Encoded: boolean}> {
    if (!this.cdpSession) {
      throw new Error('CDP session not available');
    }
    return this.withTimeout(
      this.cdpSession.send('Network.getResponseBody', {
        requestId,
      }) as Promise<{body: string; base64Encoded: boolean}>,
      this.RESPONSE_BODY_TIMEOUT_MS,
      `Timed out retrieving response body for ${requestId}`,
    );
  }

  /**
   * 浏览器断开时清除会话引用（避免残留指针）。
   */
  reset(): void {
    this.cdpSession = null;
    this.cdpListeners = {};
  }

  /**
   * 创建 Network.responseReceived 处理器。
   *
   * 闭包捕获 `files` 数组，通过 registry 进行去重和缓存。
   * 抓取逻辑：
   * 1. 检查文件数量上限
   * 2. 过滤 Script / javascript MIME / .js URL
   * 3. 获取响应体（带超时）
   * 4. 截断超大文件
   * 5. 去重并写入 files 与 registry
   */
  private createCaptureHandler(
    files: CodeFile[],
    registry: CollectedFileRegistry,
  ): CdpResponseHandler {
    return async (params: any) => {
      const {response, requestId, type} = params;
      const url = response.url;

      // 🔧 修复：只限制文件数量，不限制总大小（支持大型网站完整收集）
      if (registry.hasReachedFileLimit(files.length)) {
        if (files.length === registry.MAX_FILES_PER_COLLECT) {
          logger.warn(
            `⚠️  Reached max files limit (${registry.MAX_FILES_PER_COLLECT}), will skip remaining files`,
          );
        }
        return;
      }

      // 过滤JavaScript资源
      if (
        type === 'Script' ||
        response.mimeType?.includes('javascript') ||
        url.endsWith('.js')
      ) {
        try {
          // ✅ 修复：检查 cdpSession 是否存在
          if (!this.cdpSession) {
            logger.warn(`[CDP] Session not available for: ${url}`);
            return;
          }

          // 获取响应体
          const {body, base64Encoded} = await this.getResponseBody(requestId);

          const content = base64Encoded
            ? Buffer.from(body, 'base64').toString('utf-8')
            : body;
          const contentSize = content.length;

          // 🔧 限制单文件大小（防止单个文件过大）
          let finalContent = content;
          let truncated = false;
          if (contentSize > registry.MAX_SINGLE_FILE_SIZE) {
            finalContent = content.substring(0, registry.MAX_SINGLE_FILE_SIZE);
            truncated = true;
            logger.warn(
              `[CDP] Large file truncated: ${url} (${(contentSize / 1024).toFixed(2)} KB -> ${(registry.MAX_SINGLE_FILE_SIZE / 1024).toFixed(2)} KB)`,
            );
          }

          // 防止重复收集
          if (!registry.hasUrl(url)) {
            registry.addUrl(url);

            const file: CodeFile = {
              url,
              content: finalContent,
              size: finalContent.length,
              type: 'external',
              metadata: registry.buildFileMetadata(
                truncated,
                contentSize,
                finalContent.length,
                url,
              ),
            };
            files.push(file);

            // 🆕 同时存储到缓存，供后续按需获取
            registry.addFile(url, file);

            logger.debug(
              `[CDP] Collected (${files.length}/${registry.MAX_FILES_PER_COLLECT}): ${url} (${(finalContent.length / 1024).toFixed(2)} KB)${truncated ? ' [TRUNCATED]' : ''}`,
            );
          }
        } catch (error) {
          logger.warn(`[CDP] Failed to get response body for: ${url}`, error);
        }
      }
    };
  }

  /**
   * 带超时的 Promise 包装。提取自 CodeCollector.withTimeout。
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(message));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
