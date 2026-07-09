/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DebuggerSessionStore - 调试会话导入/导出策略模块。
 *
 * 提取自 DebuggerManager.ts，负责：
 * 1. exportSession：将当前断点 + pauseOnExceptions 状态序列化为 DebuggerSession
 * 2. saveSession：将会话写入文件（默认目录由 facade 提供）
 * 3. loadSessionFromFile / importSession：从文件或对象恢复断点
 * 4. listSavedSessions：列出已保存的会话文件
 *
 * 通过 `getBreakpointManager` 访问断点策略模块（避免循环依赖），
 * 通过 `getDefaultSessionsDir` 与 `isEnabled` 由 facade 注入。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {DebuggerSession} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import type {BreakpointManager} from './BreakpointManager.js';
import type {WatchExpressionManager} from './WatchExpressionManager.js';

export class DebuggerSessionStore {
  constructor(
    private getBreakpointManager: () => BreakpointManager,
    private getDefaultSessionsDir: () => string,
    private isEnabled: () => boolean,
    private getWatchManager?: () => WatchExpressionManager | null,
  ) {}

  exportSession(metadata?: DebuggerSession['metadata']): DebuggerSession {
    const bpm = this.getBreakpointManager();
    const session: DebuggerSession = {
      version: '1.1',
      timestamp: Date.now(),
      breakpoints: bpm.getBreakpointsForExport(),
      pauseOnExceptions: bpm.getPauseOnExceptionsState(),
      metadata: metadata || {},
      watches: this.getWatchManager?.()?.exportWatches() ?? [],
    };

    logger.info('Session exported', {
      breakpointCount: session.breakpoints.length,
      pauseOnExceptions: session.pauseOnExceptions,
    });

    return session;
  }

  async saveSession(
    filePath?: string,
    metadata?: DebuggerSession['metadata'],
  ): Promise<string> {
    const session = this.exportSession(metadata);

    if (!filePath) {
      const sessionsDir = this.getDefaultSessionsDir();
      await fs.mkdir(sessionsDir, {recursive: true});
      filePath = path.join(sessionsDir, `session-${Date.now()}.json`);
    } else {
      await fs.mkdir(path.dirname(filePath), {recursive: true});
    }

    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');

    logger.info(`Session saved to ${filePath}`, {
      breakpointCount: session.breakpoints.length,
    });

    return filePath;
  }

  async loadSessionFromFile(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    const session: DebuggerSession = JSON.parse(content);
    await this.importSession(session);

    logger.info(`Session loaded from ${filePath}`, {
      breakpointCount: session.breakpoints.length,
    });
  }

  async importSession(sessionData: DebuggerSession | string): Promise<void> {
    if (!this.isEnabled()) {
      throw new Error(
        'Debugger must be enabled before importing session. Call init() or enable() first.',
      );
    }

    const session: DebuggerSession =
      typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;

    if (session.version !== '1.0' && session.version !== '1.1') {
      logger.warn(
        `Session version mismatch: ${session.version} (expected 1.0 or 1.1)`,
      );
    }

    logger.info('Importing session...', {
      breakpointCount: session.breakpoints.length,
      pauseOnExceptions: session.pauseOnExceptions,
      timestamp: new Date(session.timestamp).toISOString(),
    });

    const bpm = this.getBreakpointManager();
    await bpm.clearAllBreakpoints();

    let successCount = 0;
    let failCount = 0;

    for (const bp of session.breakpoints) {
      try {
        if (bp.location.url) {
          await bpm.setBreakpointByUrl({
            url: bp.location.url,
            lineNumber: bp.location.lineNumber,
            columnNumber: bp.location.columnNumber,
            condition: bp.condition,
          });
        } else if (bp.location.scriptId) {
          await bpm.setBreakpoint({
            scriptId: bp.location.scriptId,
            lineNumber: bp.location.lineNumber,
            columnNumber: bp.location.columnNumber,
            condition: bp.condition,
          });
        } else {
          logger.warn('Breakpoint has neither url nor scriptId, skipping', bp);
          failCount++;
          continue;
        }
        successCount++;
      } catch (error) {
        logger.error('Failed to restore breakpoint:', error, bp);
        failCount++;
      }
    }

    if (session.pauseOnExceptions) {
      await bpm.setPauseOnExceptions(session.pauseOnExceptions);
    }

    const watchData = (session as any).watches;
    if (Array.isArray(watchData) && watchData.length > 0) {
      const wm = this.getWatchManager?.();
      if (wm) {
        wm.importWatches(watchData);
      }
    }

    logger.info('Session imported', {
      totalBreakpoints: session.breakpoints.length,
      successCount,
      failCount,
      pauseOnExceptions: session.pauseOnExceptions,
    });
  }

  async mergeSession(sessionData: DebuggerSession | string): Promise<void> {
    if (!this.isEnabled()) {
      throw new Error('Debugger must be enabled before merging session.');
    }

    const session: DebuggerSession =
      typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;

    const bpm = this.getBreakpointManager();
    const existingBps = bpm.listBreakpoints();

    let addedCount = 0;
    let skippedCount = 0;

    for (const bp of session.breakpoints) {
      const isDuplicate = existingBps.some(existing => {
        if (bp.location.url && existing.location.url) {
          return (
            existing.location.url === bp.location.url &&
            existing.location.lineNumber === bp.location.lineNumber &&
            existing.location.columnNumber === bp.location.columnNumber
          );
        }
        if (bp.location.scriptId && existing.location.scriptId) {
          return (
            existing.location.scriptId === bp.location.scriptId &&
            existing.location.lineNumber === bp.location.lineNumber &&
            existing.location.columnNumber === bp.location.columnNumber
          );
        }
        return false;
      });

      if (isDuplicate) {
        skippedCount++;
        continue;
      }

      try {
        if (bp.location.url) {
          await bpm.setBreakpointByUrl({
            url: bp.location.url,
            lineNumber: bp.location.lineNumber,
            columnNumber: bp.location.columnNumber,
            condition: bp.condition,
          });
        } else if (bp.location.scriptId) {
          await bpm.setBreakpoint({
            scriptId: bp.location.scriptId,
            lineNumber: bp.location.lineNumber,
            columnNumber: bp.location.columnNumber,
            condition: bp.condition,
          });
        }
        addedCount++;
      } catch (error) {
        logger.error('Failed to merge breakpoint:', error, bp);
      }
    }

    if (session.pauseOnExceptions) {
      const current = bpm.getPauseOnExceptionsState();
      const severity: Record<string, number> = {none: 0, uncaught: 1, all: 2};
      if ((severity[session.pauseOnExceptions] ?? 0) > (severity[current] ?? 0)) {
        await bpm.setPauseOnExceptions(session.pauseOnExceptions);
      }
    }

    const watchData = (session as any).watches;
    if (Array.isArray(watchData) && watchData.length > 0) {
      const wm = this.getWatchManager?.();
      if (wm) {
        wm.importWatches(watchData);
      }
    }

    logger.info('Session merged', {addedCount, skippedCount});
  }

  async listSavedSessions(): Promise<
    Array<{path: string; timestamp: number; metadata?: unknown}>
  > {
    const sessionsDir = this.getDefaultSessionsDir();

    try {
      await fs.access(sessionsDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(sessionsDir);
    const sessions: Array<{
      path: string;
      timestamp: number;
      metadata?: unknown;
    }> = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(sessionsDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const session: DebuggerSession = JSON.parse(content);
        sessions.push({
          path: filePath,
          timestamp: session.timestamp,
          metadata: session.metadata,
        });
      } catch (error) {
        logger.warn(`Failed to read session file ${file}:`, error);
      }
    }

    sessions.sort((a, b) => b.timestamp - a.timestamp);
    return sessions;
  }
}
