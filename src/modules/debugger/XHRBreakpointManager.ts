/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * XHRBreakpointManager - XHR/Fetch 断点管理
 *
 * 功能:
 * 1. 设置 XHR/Fetch 断点(URL 模式匹配)
 * 2. 在网络请求发送前暂停执行
 * 3. 追踪请求参数和响应
 *
 * 设计原则:
 * - 使用 CDP DOMDebugger.setXHRBreakpoint
 * - 支持通配符模式匹配
 * - 提供断点命中统计
 */

import type {CDPSession} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';

export interface XHRBreakpoint {
  id: string;
  urlPattern: string;
  enabled: boolean;
  hitCount: number;
  createdAt: number;
}

/**
 * XHR 断点管理器
 *
 * 重构:使用共享的 CDP session,不再创建独立 session
 */
export class XHRBreakpointManager {
  private xhrBreakpoints = new Map<string, XHRBreakpoint>();
  private breakpointCounter = 0;

  constructor(private cdpSession: CDPSession) {
    logger.info('XHRBreakpointManager initialized with shared CDP session');
  }

  async setXHRBreakpoint(urlPattern: string): Promise<string> {
    await this.cdpSession.send('DOMDebugger.setXHRBreakpoint', {
      url: urlPattern,
    });

    const breakpointId = `xhr_${++this.breakpointCounter}`;
    this.xhrBreakpoints.set(breakpointId, {
      id: breakpointId,
      urlPattern,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    });

    logger.info(`XHR breakpoint set: ${urlPattern}`, {breakpointId});
    return breakpointId;
  }

  async removeXHRBreakpoint(breakpointId: string): Promise<boolean> {
    const breakpoint = this.xhrBreakpoints.get(breakpointId);
    if (!breakpoint) {
      return false;
    }

    await this.cdpSession.send('DOMDebugger.removeXHRBreakpoint', {
      url: breakpoint.urlPattern,
    });

    this.xhrBreakpoints.delete(breakpointId);
    logger.info(`XHR breakpoint removed: ${breakpointId}`);
    return true;
  }

  getAllXHRBreakpoints(): XHRBreakpoint[] {
    return Array.from(this.xhrBreakpoints.values());
  }

  getXHRBreakpoint(breakpointId: string): XHRBreakpoint | undefined {
    return this.xhrBreakpoints.get(breakpointId);
  }

  async clearAllXHRBreakpoints(): Promise<void> {
    const breakpoints = Array.from(this.xhrBreakpoints.values());

    for (const bp of breakpoints) {
      try {
        await this.cdpSession.send('DOMDebugger.removeXHRBreakpoint', {
          url: bp.urlPattern,
        });
      } catch (error) {
        logger.warn(`Failed to remove XHR breakpoint ${bp.id}:`, error);
      }
    }

    this.xhrBreakpoints.clear();
    logger.info('All XHR breakpoints cleared');
  }

  async close(): Promise<void> {
    try {
      await this.clearAllXHRBreakpoints();
      logger.info('XHRBreakpointManager closed');
    } catch (error) {
      logger.error('Failed to close XHRBreakpointManager:', error);
      throw error;
    }
  }
}
