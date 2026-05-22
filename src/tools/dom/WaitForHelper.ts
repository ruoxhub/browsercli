/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page, CDPSession} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';

/**
 * WaitForHelper — Playwright 适配版
 *
 * 页面操作后的等待协调器，解决「执行操作 → 等待导航 → 等待DOM稳定」的异步时序问题。
 *
 * 核心流程 (waitForEventsAfterAction):
 * 1. 注册导航监听
 * 2. 执行用户操作（如点击按钮）
 * 3. 如果触发了跨文档导航，等 waitForNavigation 完成
 * 4. 最后等 DOM 稳定
 * 5. 整体 15s 超时防死等
 */
export class WaitForHelper {
  #abortController = new AbortController();
  #page: Page;
  #cdpSession?: CDPSession;
  #cdpSessionClosed = false;
  #stableDomTimeout: number;
  #stableDomFor: number;
  #expectNavigationIn: number;
  #navigationTimeout: number;

  constructor(
    page: Page,
    cpuTimeoutMultiplier: number,
    networkTimeoutMultiplier: number,
  ) {
    this.#stableDomTimeout = 3000 * cpuTimeoutMultiplier;
    this.#stableDomFor = 100 * cpuTimeoutMultiplier;
    this.#expectNavigationIn = 100 * cpuTimeoutMultiplier;
    this.#navigationTimeout = 3000 * networkTimeoutMultiplier;
    this.#page = page;
  }

  /**
   * 获取或创建 CDP Session（Playwright 通过 context.newCDPSession 访问 CDP）
   */
  async #ensureCdpSession(): Promise<CDPSession> {
    if (!this.#cdpSession || this.#cdpSessionClosed) {
      this.#cdpSession = await this.#page.context().newCDPSession(this.#page);
      this.#cdpSessionClosed = false;
      this.#cdpSession.on('close', () => {
        this.#cdpSessionClosed = true;
      });
    }
    return this.#cdpSession;
  }

  /**
   * 等待 DOM 稳定。
   *
   * 通过 MutationObserver 监听 DOM 变化，当 DOM 在指定时间内无变化时才 resolve。
   * 超时兜底防止无限等待。
   */
  async waitForStableDom(): Promise<void> {
    const stableDomObserver = await this.#page.evaluateHandle(timeout => {
      let timeoutId: ReturnType<typeof setTimeout>;
      function callback() {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          domObserver.resolver.resolve();
          domObserver.observer.disconnect();
        }, timeout);
      }
      const domObserver = {
        resolver: Promise.withResolvers<void>(),
        observer: new MutationObserver(callback),
      };
      // It's possible that the DOM is not gonna change so we
      // need to start the timeout initially.
      callback();

      domObserver.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      return domObserver;
    }, this.#stableDomFor);

    this.#abortController.signal.addEventListener('abort', async () => {
      try {
        await stableDomObserver.evaluate(observer => {
          observer.observer.disconnect();
          observer.resolver.resolve();
        });
        await stableDomObserver.dispose();
      } catch {
        // Ignored cleanup errors
      }
    });

    return Promise.race([
      stableDomObserver.evaluate(async observer => {
        return await observer.resolver.promise;
      }),
      this.timeout(this.#stableDomTimeout).then(() => {
        throw new Error('Timeout');
      }),
    ]);
  }

  /**
   * 等待导航开始。
   *
   * 通过 CDP 的 Page.frameStartedNavigating 事件检测导航，
   * 区分同文档导航（historySameDocument/historyDifferentDocument/sameDocument）
   * 与跨文档导航。
   *
   * @returns true 表示发生了跨文档导航，false 表示同文档导航或超时
   */
  async waitForNavigationStarted(): Promise<boolean> {
    const cdp = await this.#ensureCdpSession();

    const navigationStartedPromise = new Promise<boolean>(resolve => {
      const listener = (event: {navigationType: string; frameId: string}) => {
        if (
          [
            'historySameDocument',
            'historyDifferentDocument',
            'sameDocument',
          ].includes(event.navigationType)
        ) {
          resolve(false);
          return;
        }

        resolve(true);
      };

      cdp.on('Page.frameStartedNavigating', listener);
      this.#abortController.signal.addEventListener('abort', () => {
        resolve(false);
        cdp.off('Page.frameStartedNavigating', listener);
      });
    });

    // 启用 Page 域以接收导航事件
    try {
      await cdp.send('Page.enable');
    } catch {
      // 可能已启用，忽略
    }

    return await Promise.race([
      navigationStartedPromise,
      this.timeout(this.#expectNavigationIn).then(() => false),
    ]);
  }

  timeout(time: number): Promise<void> {
    return new Promise<void>(res => {
      const id = setTimeout(res, time);
      this.#abortController.signal.addEventListener('abort', () => {
        res();
        clearTimeout(id);
      });
    });
  }

  /**
   * 主入口：执行操作并等待后续事件。
   *
   * 组合 waitForNavigationStarted + waitForNavigation + waitForStableDom：
   * 1. 注册导航监听
   * 2. 执行用户操作
   * 3. 如果触发了跨文档导航，等待导航完成
   * 4. 等待 DOM 稳定
   * 5. 整体 15s 超时
   */
  async waitForEventsAfterAction(
    action: () => Promise<unknown>,
  ): Promise<void> {
    // Overall timeout to prevent infinite hanging (15 seconds max)
    const overallTimeout = new Promise<void>((_, reject) => {
      const id = setTimeout(() => {
        reject(new Error('Overall navigation timeout'));
      }, 15000);
      this.#abortController.signal.addEventListener('abort', () => {
        clearTimeout(id);
      });
    });

    const doAction = async () => {
      const navigationFinished = this.waitForNavigationStarted()
        .then(async navigationStarted => {
          if (navigationStarted) {
            // Playwright: waitForNavigation 在 action 前调用也能正常工作
            await this.#page.waitForURL('**', {
              timeout: this.#navigationTimeout,
            }).catch(() => {
              // 导航等待失败不中断流程
            });
          }
        })
        .catch(error => logger.debug('Wait error', error));

      try {
        await action();
      } catch (error) {
        // Clear up pending promises
        this.#abortController.abort();
        throw error;
      }

      try {
        await navigationFinished;

        // Wait for stable dom after navigation so we execute in
        // the correct context
        await this.waitForStableDom();
      } catch (error) {
        logger.debug('Wait error', error);
      } finally {
        this.#abortController.abort();
        // 清理 CDP Session
        try {
          if (this.#cdpSession && !this.#cdpSessionClosed) {
            await this.#cdpSession.detach();
          }
        } catch {
          // Ignored
        }
      }
    };

    try {
      await Promise.race([doAction(), overallTimeout]);
    } catch (error) {
      logger.debug('Wait error', error);
      this.#abortController.abort();
    }
  }
}
