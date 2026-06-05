/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WatchExpressionManager - 监视表达式管理
 *
 * 功能:
 * 1. 添加/删除/启用/禁用监视表达式
 * 2. 在每次暂停时自动求值所有监视表达式
 * 3. 追踪表达式值的变化历史
 *
 * 设计原则:
 * - 依赖 RuntimeInspector 进行表达式求值
 * - 自动在断点暂停时求值
 * - 提供值变化检测
 */

import {logger} from '../../utils/logger.js';

import type {RuntimeInspector} from './RuntimeInspector.js';

export interface WatchExpression {
  id: string;
  expression: string;
  name: string;
  enabled: boolean;
  lastValue: unknown;
  lastError: Error | null;
  valueHistory: Array<{value: unknown; timestamp: number}>;
  createdAt: number;
}

export interface WatchResult {
  watchId: string;
  name: string;
  expression: string;
  value: unknown;
  error: Error | null;
  valueChanged: boolean;
  timestamp: number;
}

const MAX_HISTORY_LENGTH = 100;
const DEFAULT_EVAL_TIMEOUT_MS = 5000;

export class WatchExpressionManager {
  private watches = new Map<string, WatchExpression>();
  private watchCounter = 0;

  constructor(private runtimeInspector: RuntimeInspector) {}

  addWatch(expression: string, name?: string): string {
    const watchId = `watch_${++this.watchCounter}`;

    this.watches.set(watchId, {
      id: watchId,
      expression,
      name: name || expression,
      enabled: true,
      lastValue: undefined,
      lastError: null,
      valueHistory: [],
      createdAt: Date.now(),
    });

    logger.info(`Watch expression added: ${watchId}`, {expression, name});
    return watchId;
  }

  removeWatch(watchId: string): boolean {
    const deleted = this.watches.delete(watchId);
    if (deleted) {
      logger.info(`Watch expression removed: ${watchId}`);
    }
    return deleted;
  }

  setWatchEnabled(watchId: string, enabled: boolean): boolean {
    const watch = this.watches.get(watchId);
    if (!watch) return false;

    watch.enabled = enabled;
    logger.info(
      `Watch expression ${enabled ? 'enabled' : 'disabled'}: ${watchId}`,
    );
    return true;
  }

  getAllWatches(): WatchExpression[] {
    return Array.from(this.watches.values());
  }

  getWatch(watchId: string): WatchExpression | undefined {
    return this.watches.get(watchId);
  }

  async evaluateAll(
    callFrameId?: string,
    timeout = DEFAULT_EVAL_TIMEOUT_MS,
  ): Promise<WatchResult[]> {
    const results: WatchResult[] = [];

    for (const watch of this.watches.values()) {
      if (!watch.enabled) continue;
      results.push(await this.evaluateOne(watch, callFrameId, timeout));
    }

    return results;
  }

  private async evaluateOne(
    watch: WatchExpression,
    callFrameId: string | undefined,
    timeoutMs: number,
  ): Promise<WatchResult> {
    try {
      const value = await this.evaluateWithTimeout(
        watch.expression,
        callFrameId,
        timeoutMs,
      );

      const valueChanged = !this.deepEqual(value, watch.lastValue);

      if (valueChanged) {
        watch.valueHistory.push({value, timestamp: Date.now()});
        if (watch.valueHistory.length > MAX_HISTORY_LENGTH) {
          watch.valueHistory.shift();
        }
      }

      watch.lastValue = value;
      watch.lastError = null;

      return {
        watchId: watch.id,
        name: watch.name,
        expression: watch.expression,
        value,
        error: null,
        valueChanged,
        timestamp: Date.now(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      watch.lastError = err;

      return {
        watchId: watch.id,
        name: watch.name,
        expression: watch.expression,
        value: null,
        error: err,
        valueChanged: false,
        timestamp: Date.now(),
      };
    }
  }

  private evaluateWithTimeout(
    expression: string,
    callFrameId: string | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Evaluation timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.runtimeInspector
        .evaluate(expression, callFrameId)
        .then(value => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  clearAll(): void {
    this.watches.clear();
    logger.info('All watch expressions cleared');
  }

  getValueHistory(
    watchId: string,
  ): Array<{value: unknown; timestamp: number}> | null {
    const watch = this.watches.get(watchId);
    return watch ? watch.valueHistory : null;
  }

  /** 深度比较两个值,支持循环引用检测和深度限制 */
  private deepEqual(
    a: unknown,
    b: unknown,
    depth = 0,
    maxDepth = 10,
    seen: WeakSet<object> = new WeakSet(),
  ): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;

    if (depth > maxDepth) return false;

    const aObj = a as object;
    const bObj = b as object;
    if (seen.has(aObj) || seen.has(bObj)) return false;
    seen.add(aObj);
    seen.add(bObj);

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i], depth + 1, maxDepth, seen)) {
          return false;
        }
      }
      return true;
    }

    const keysA = Object.keys(aObj);
    const keysB = Object.keys(bObj);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!this.deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1, maxDepth, seen)) {
        return false;
      }
    }
    return true;
  }

  exportWatches(): Array<{expression: string; name: string; enabled: boolean}> {
    return Array.from(this.watches.values()).map(watch => ({
      expression: watch.expression,
      name: watch.name,
      enabled: watch.enabled,
    }));
  }

  importWatches(
    watches: Array<{expression: string; name?: string; enabled?: boolean}>,
  ): void {
    for (const watch of watches) {
      const watchId = this.addWatch(watch.expression, watch.name);
      if (watch.enabled === false) {
        this.setWatchEnabled(watchId, false);
      }
    }
    logger.info(`Imported ${watches.length} watch expressions`);
  }
}
