/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, Dialog, Page} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';

export type DialogAction = 'accept' | 'dismiss' | string;

export interface WaitForEventsResult {
  /** Action 期间触发跨文档导航后的目标 URL。 */
  navigatedToUrl?: string;
  /** Action 期间是否自动处理了弹窗。 */
  dialogHandled?: boolean;
  /** Action 期间弹出且尚未处理的原生弹窗（alert/confirm/prompt/beforeunload）。 */
  dialogOpened?: {
    type: string;
    message: string;
  };
  /** Action 期间打开的新弹窗页面数量。 */
  openedPagesCount?: number;
}

export interface WaitForEventsOptions {
  timeout?: number;
  waitForStableDom?: boolean;
  expectNavigationIn?: number;
  handleDialog?: DialogAction | Partial<Record<string, DialogAction>>;
}

export const PREDEFINED_NETWORK_MULTIPLIERS: Record<string, number> = {
  'Fast 4G': 1,
  'Slow 4G': 2.5,
  'Fast 3G': 5,
  'Slow 3G': 10,
};

export function getNetworkMultiplierFromString(
  condition: string | null | undefined,
): number {
  if (!condition) {
    return 1;
  }
  return PREDEFINED_NETWORK_MULTIPLIERS[condition] ?? 1;
}

/**
 * WaitForHelper — Patchright / CDP 页面操作后的事件协调器。
 *
 * 解决「执行操作 → 监听弹窗/新页/导航 → 等待导航完成 → 等待 DOM 稳定」的异步时序问题。
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

  #dialogHandled = false;
  #dialogDetected = false;
  #dialogOpened?: {type: string; message: string};
  #initialUrl: string;
  #loadedNewDocument = false;
  #openedPagesCount = 0;

  constructor(
    page: Page,
    cpuTimeoutMultiplier = 1,
    networkTimeoutMultiplier = 1,
  ) {
    this.#stableDomTimeout = 3000 * cpuTimeoutMultiplier;
    this.#stableDomFor = 100 * cpuTimeoutMultiplier;
    this.#expectNavigationIn = 100 * cpuTimeoutMultiplier;
    this.#navigationTimeout = 3000 * networkTimeoutMultiplier;
    this.#page = page;
    this.#initialUrl = typeof page.url === 'function' ? page.url() : '';
  }

  async #ensureCdpSession(): Promise<CDPSession | undefined> {
    if (this.#cdpSession && !this.#cdpSessionClosed) {
      return this.#cdpSession;
    }
    const ctx =
      typeof this.#page.context === 'function'
        ? this.#page.context()
        : undefined;
    if (!ctx || typeof ctx.newCDPSession !== 'function') {
      return undefined;
    }
    this.#cdpSession = await ctx.newCDPSession(this.#page);
    this.#cdpSessionClosed = false;
    this.#cdpSession.on('close', () => {
      this.#cdpSessionClosed = true;
    });
    return this.#cdpSession;
  }

  /**
   * 通过 MutationObserver 等待 DOM 在短时间窗口内不再发生变更。
   */
  async waitForStableDom(): Promise<void> {
    if (typeof this.#page.evaluateHandle !== 'function') {
      return;
    }
    const stableDomObserver = await Promise.race([
      this.#page.evaluateHandle(timeout => {
        let timeoutId: ReturnType<typeof setTimeout>;
        function callback(): void {
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
        callback();
        if (document.body) {
          domObserver.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
          });
        }
        return domObserver;
      }, this.#stableDomFor),
      this.timeout(this.#stableDomTimeout).then(() => undefined),
    ]).catch(() => undefined);

    if (!stableDomObserver) {
      return;
    }

    this.#abortController.signal.addEventListener('abort', async () => {
      try {
        await stableDomObserver.evaluate(observer => {
          observer.observer.disconnect();
          observer.resolver.resolve();
        });
        await stableDomObserver.dispose();
      } catch {
        // 清理失败忽略
      }
    });

    await Promise.race([
      stableDomObserver.evaluate(async observer => {
        return await observer.resolver.promise;
      }),
      this.timeout(this.#stableDomTimeout),
    ]).catch(() => undefined);
  }

  async waitForNavigationStarted(
    expectNavigationIn = this.#expectNavigationIn,
  ): Promise<boolean> {
    const cdp = await this.#ensureCdpSession().catch(() => undefined);
    if (!cdp) {
      return false;
    }

    const navigationStartedPromise = new Promise<boolean>(resolve => {
      const listener = (event: {navigationType: string}) => {
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
        this.#loadedNewDocument = true;
        resolve(true);
      };

      cdp.on('Page.frameStartedNavigating', listener);
      this.#abortController.signal.addEventListener('abort', () => {
        resolve(false);
        cdp.off('Page.frameStartedNavigating', listener);
      });
    });

    try {
      await cdp.send('Page.enable');
    } catch {
      // 忽略 Page.enable 异常
    }

    return await Promise.race([
      navigationStartedPromise,
      this.timeout(expectNavigationIn).then(() => false),
    ]);
  }

  timeout(time: number): Promise<void> {
    if (this.#abortController.signal.aborted) {
      return Promise.resolve();
    }
    return new Promise<void>(res => {
      const id = setTimeout(res, time);
      this.#abortController.signal.addEventListener('abort', () => {
        res();
        clearTimeout(id);
      });
    });
  }

  /**
   * 执行页面操作并等待可能发生的弹窗、导航与 DOM 稳定。
   */
  async waitForEventsAfterAction(
    action: (signal: AbortSignal) => Promise<unknown>,
    options?: WaitForEventsOptions,
  ): Promise<WaitForEventsResult> {
    if (this.#abortController.signal.aborted) {
      throw new Error("Can't re-use a WaitForHelper");
    }

    let resolveDialogInterrupt!: () => void;
    const dialogInterruptPromise = new Promise<void>(resolve => {
      resolveDialogInterrupt = resolve;
    });

    const dialogHandler = (dialog: Dialog): void => {
      this.#dialogDetected = true;
      let actionToTake: DialogAction | undefined;

      if (typeof options?.handleDialog === 'object') {
        actionToTake = options.handleDialog[dialog.type()];
      } else {
        actionToTake = options?.handleDialog;
      }

      if (actionToTake) {
        this.#dialogHandled = true;
        if (actionToTake === 'dismiss') {
          void dialog.dismiss().catch(() => undefined);
        } else if (actionToTake === 'accept') {
          void dialog.accept().catch(() => undefined);
        } else {
          void dialog.accept(actionToTake).catch(() => undefined);
        }
      } else {
        this.#dialogOpened = {
          type: typeof dialog.type === 'function' ? dialog.type() : 'dialog',
          message: typeof dialog.message === 'function' ? dialog.message() : '',
        };
        this.#abortController.abort(
          new Error('Action interrupted by a dialog'),
        );
        resolveDialogInterrupt();
      }
    };

    const popupHandler = (): void => {
      this.#openedPagesCount += 1;
    };

    const frameNavigatedHandler = (): void => {
      this.#loadedNewDocument = true;
    };

    const hasOn = typeof this.#page.on === 'function';
    const hasOff = typeof this.#page.off === 'function';
    if (hasOn) {
      this.#page.on('dialog', dialogHandler);
      this.#page.on('popup', popupHandler);
      this.#page.on('framenavigated', frameNavigatedHandler);
    }

    const overallTimeoutMs = Math.max(options?.timeout ?? 15_000, 1000);
    let overallTimer: ReturnType<typeof setTimeout> | undefined;
    const overallTimeout = new Promise<void>((_, reject) => {
      overallTimer = setTimeout(() => {
        reject(new Error('Overall action wait timeout'));
      }, overallTimeoutMs);
    });

    const run = async (): Promise<void> => {
      const navWaitPromise = this.waitForNavigationStarted(
        options?.expectNavigationIn,
      )
        .then(async navigationStarted => {
          if (
            navigationStarted &&
            typeof this.#page.waitForURL === 'function'
          ) {
            await this.#page
              .waitForURL('**', {
                timeout: options?.timeout ?? this.#navigationTimeout,
              })
              .catch(() => undefined);
          }
        })
        .catch(error => logger.debug('WaitForHelper nav wait error', error));

      const actionPromise = Promise.resolve().then(() =>
        action(this.#abortController.signal),
      );
      // 防止因原生弹窗提前返回后，底层仍在挂起的 click/fill Promise 后续 reject 触发 UnhandledRejection
      void actionPromise.catch(() => undefined);

      try {
        await Promise.race([actionPromise, dialogInterruptPromise]);
      } catch (error) {
        if (!this.#dialogOpened) {
          this.#abortController.abort();
          throw error;
        }
      }

      if (this.#dialogOpened) {
        return;
      }

      try {
        await Promise.race([navWaitPromise, dialogInterruptPromise]);
        if (this.#dialogDetected) {
          return;
        }
        if (options?.waitForStableDom !== false) {
          await Promise.race([
            this.waitForStableDom(),
            dialogInterruptPromise,
          ]);
        }
      } catch (error) {
        logger.debug('WaitForHelper settle error', error);
      }
    };

    const runPromise = run();
    void runPromise.catch(() => undefined);

    try {
      await Promise.race([runPromise, overallTimeout, dialogInterruptPromise]);
    } catch (error) {
      if (!this.#dialogDetected) {
        throw error;
      }
    } finally {
      if (overallTimer !== undefined) {
        clearTimeout(overallTimer);
      }
      this.#abortController.abort();
      if (hasOff) {
        this.#page.off('dialog', dialogHandler);
        this.#page.off('popup', popupHandler);
        this.#page.off('framenavigated', frameNavigatedHandler);
      }
      try {
        if (this.#cdpSession && !this.#cdpSessionClosed) {
          // 页面处于 JS 弹窗阻塞态时，detach() 可能挂起；加 500ms 兜底超时防止永久阻塞 worker
          const detachPromise = this.#cdpSession
            .detach()
            .catch(() => undefined);
          await Promise.race([
            detachPromise,
            new Promise<void>(resolve => setTimeout(resolve, 500)),
          ]);
        }
      } catch {
        // 忽略清理异常
      }
    }

    return this.#getResult();
  }

  #getResult(): WaitForEventsResult {
    const urlAfterAction =
      typeof this.#page.url === 'function' ? this.#page.url() : '';
    return {
      ...(urlAfterAction !== this.#initialUrl || this.#loadedNewDocument
        ? {navigatedToUrl: urlAfterAction}
        : {}),
      ...(this.#dialogHandled ? {dialogHandled: true} : {}),
      ...(this.#dialogOpened ? {dialogOpened: this.#dialogOpened} : {}),
      ...(this.#openedPagesCount > 0
        ? {openedPagesCount: this.#openedPagesCount}
        : {}),
    };
  }
}
