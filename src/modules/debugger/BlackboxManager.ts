/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BlackboxManager - 黑盒化管理
 *
 * 功能:
 * 1. 黑盒化脚本(按 URL 模式)
 * 2. 单步调试时自动跳过黑盒化的代码
 * 3. 调用栈中隐藏黑盒化的帧
 *
 * 设计原则:
 * - 使用 CDP Debugger.setBlackboxPatterns
 * - 提供常用库的预定义黑盒化规则
 * - 支持自定义模式
 */

import type {CDPSession} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';

import type {ScriptPosition} from './types.js';

/**
 * 黑盒化管理器
 *
 * 重构:使用共享的 CDP session,不再创建独立 session
 */
export class BlackboxManager {
  private blackboxedPatterns = new Set<string>();

  /** 预定义的常用库模式(CDP Debugger.setBlackboxPatterns 要求正则表达式) */
  static readonly COMMON_LIBRARY_PATTERNS = [
    '.*jquery.*\\.js',
    '.*react.*\\.js',
    '.*react-dom.*\\.js',
    '.*vue.*\\.js',
    '.*angular.*\\.js',
    '.*lodash.*\\.js',
    '.*underscore.*\\.js',
    '.*moment.*\\.js',
    '.*axios.*\\.js',
    '.*node_modules/.*',
    '.*webpack.*',
    '.*bundle.*\\.js',
    '.*vendor.*\\.js',
  ];

  constructor(private getSession: () => CDPSession) {
    logger.info('BlackboxManager initialized with shared CDP session');
  }

  async blackboxByPattern(urlPattern: string): Promise<void> {
    this.blackboxedPatterns.add(urlPattern);

    try {
      await this.getSession().send('Debugger.setBlackboxPatterns', {
        patterns: Array.from(this.blackboxedPatterns),
      });
      logger.info(`Blackboxed pattern: ${urlPattern}`);
    } catch (error) {
      this.blackboxedPatterns.delete(urlPattern);
      logger.error('Failed to set blackbox pattern:', error);
      throw error;
    }
  }

  async unblackboxByPattern(urlPattern: string): Promise<boolean> {
    if (!this.blackboxedPatterns.delete(urlPattern)) {
      return false;
    }

    try {
      await this.getSession().send('Debugger.setBlackboxPatterns', {
        patterns: Array.from(this.blackboxedPatterns),
      });
      logger.info(`Unblackboxed pattern: ${urlPattern}`);
      return true;
    } catch (error) {
      this.blackboxedPatterns.add(urlPattern);
      logger.error('Failed to remove blackbox pattern:', error);
      throw error;
    }
  }

  async blackboxCommonLibraries(): Promise<void> {
    for (const pattern of BlackboxManager.COMMON_LIBRARY_PATTERNS) {
      this.blackboxedPatterns.add(pattern);
    }

    await this.getSession().send('Debugger.setBlackboxPatterns', {
      patterns: Array.from(this.blackboxedPatterns),
    });

    logger.info(
      `Blackboxed ${BlackboxManager.COMMON_LIBRARY_PATTERNS.length} common library patterns`,
    );
  }

  getAllBlackboxedPatterns(): string[] {
    return Array.from(this.blackboxedPatterns);
  }

  async clearAllBlackboxedPatterns(): Promise<void> {
    this.blackboxedPatterns.clear();
    await this.getSession().send('Debugger.setBlackboxPatterns', {
      patterns: [],
    });
    logger.info('All blackbox patterns cleared');
  }

  async setBlackboxedRanges(
    scriptId: string,
    positions: ScriptPosition[],
  ): Promise<void> {
    await this.getSession().send('Debugger.setBlackboxedRanges', {
      scriptId,
      positions,
    });
    logger.info(`Blackboxed ranges set for script: ${scriptId}`, {
      rangeCount: positions.length,
    });
  }

  async close(): Promise<void> {
    try {
      await this.clearAllBlackboxedPatterns();
      logger.info('BlackboxManager closed');
    } catch (error) {
      logger.error('Failed to close BlackboxManager:', error);
      throw error;
    }
  }
}
