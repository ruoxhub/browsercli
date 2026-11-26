/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 配置文件热重载监听器（参考 chrome-devtools-mcp/src/config/ConfigWatcher.ts）。
 *
 * 设计要点：
 * - 启动时通过 `fs.realpathSync` 解析符号链接并监听目标文件所在目录，
 *   兼容编辑器通过「写临时文件再 rename 覆盖」的原子保存行为
 * - 内置防抖（默认 200ms），折叠单次保存触发的多次 OS fs 事件
 * - 部分平台事件回调不提供文件名（`changedFileName === null`），此时不过滤
 * - 内容去重：仅当文件实际内容变化时才触发 `onChange`
 * - 异步串行化：通过 `#pending` 队列保证前后两次 `onChange` 不并发交错
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DEBOUNCE_MS = 200;

function readContent(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ConfigWatcherOptions {
  debounceMs?: number;
  onError?: (message: string, err: unknown) => void;
}

export class ConfigWatcher {
  readonly #configPath: string;
  readonly #onChange: (content: string) => Promise<void>;
  readonly #debounceMs: number;
  readonly #onError: (message: string, err: unknown) => void;
  #watcher?: fs.FSWatcher;
  #timer?: ReturnType<typeof setTimeout>;
  #content?: string;
  #pending = Promise.resolve();
  #disposed = false;

  constructor(
    configPath: string,
    onChange: (content: string) => Promise<void>,
    options: ConfigWatcherOptions = {},
  ) {
    this.#configPath = configPath;
    this.#onChange = onChange;
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#onError =
      options.onError ??
      ((message, err) => {
        console.error(message, err);
      });
  }

  get isWatching(): boolean {
    return this.#watcher !== undefined;
  }

  /**
   * 开始监听配置文件。若 `configPath` 不存在，会由 `fs.realpathSync` 抛出异常。
   */
  start(): void {
    if (this.#watcher) {
      return;
    }
    this.#disposed = false;
    const realPath = fs.realpathSync(this.#configPath);
    const fileName = path.basename(realPath);
    this.#content = readContent(realPath);

    const scheduleCheck = () => {
      if (this.#disposed) return;
      if (this.#timer !== undefined) {
        clearTimeout(this.#timer);
      }
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        if (this.#disposed) return;
        const content = readContent(realPath);
        if (content === undefined || content === this.#content) {
          return;
        }
        this.#content = content;
        this.#pending = this.#pending
          .then(() => this.#onChange(content))
          .catch(err => {
            this.#onError(`Failed to apply ${this.#configPath}:`, err);
          });
      }, this.#debounceMs);
      this.#timer.unref?.();
    };

    this.#watcher = fs.watch(
      path.dirname(realPath),
      {persistent: false},
      (_eventType, changedFileName) => {
        if (changedFileName !== null && changedFileName !== fileName) {
          return;
        }
        scheduleCheck();
      },
    );

    this.#watcher.on('error', err => {
      this.#onError(
        `Stopped watching ${this.#configPath}: ${getErrorMessage(err)}`,
        err,
      );
      this.dispose();
    });
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#watcher?.close();
    this.#watcher = undefined;
  }
}
