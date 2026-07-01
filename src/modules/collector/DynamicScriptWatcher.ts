/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dynamic script watcher — 等待动态加载的脚本稳定。
 *
 * 提取自 CodeCollector.ts。负责：
 * - 等待页面网络空闲（优先使用 Playwright 的 waitForNetworkIdle）
 * - 退化到基于时间的等待
 *
 * 该模块无状态，可安全复用。
 */

import type {Page} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';

/**
 * 动态脚本等待器。封装 network idle / 时间等待策略。
 */
export class DynamicScriptWatcher {
  /**
   * 等待动态脚本基本稳定，优先使用 Puppeteer 的网络空闲能力
   */
  async waitForStability(page: Page, waitMs: number): Promise<void> {
    if (waitMs <= 0) {
      return;
    }

    const pageWithNetworkIdle = page as unknown as {
      waitForNetworkIdle?: (options?: {
        idleTime?: number;
        timeout?: number;
      }) => Promise<void>;
    };

    if (typeof pageWithNetworkIdle.waitForNetworkIdle === 'function') {
      try {
        await pageWithNetworkIdle.waitForNetworkIdle({
          idleTime: Math.min(1000, Math.max(300, Math.floor(waitMs / 3))),
          timeout: waitMs,
        });
        return;
      } catch (error) {
        logger.debug('[Dynamic] waitForNetworkIdle timeout/fallback', error);
      }
    }

    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}
