/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {BrowserContext, Page, Response} from 'patchright';

import {CDP_BODY_CAPTURE_ENABLED} from '../../modules/network/constants.js';
import type {CdpBodyReader} from '../../modules/session/adapters/CdpRequestAdapter.js';
import {fromCdpResponse} from '../../modules/session/adapters/index.js';
import type {CaptureEngine} from '../../modules/session/index.js';
import type {CapturedRequestInput} from '../../modules/session/types.js';
import {logger} from '../../utils/logger.js';

export interface SessionCaptureBridgeOptions {
  /** 是否主动取响应体；缺省读 CDP_BODY_CAPTURE_ENABLED（spec §13-D3）。 */
  captureBody?: boolean;
  now?: () => number;
}

/** 关掉取体时的替身：不 await response.text()，省掉 SSE/大体的开销。 */
const skipBody: CdpBodyReader = () => Promise.resolve(null);

/**
 * CDP 抓包链路的挂载点（spec §4）。
 *
 * 三条硬约束：
 * 1. **绝不向 Playwright 抛**：监听回调里的一切（adapter 取体、落库）都包在
 *    try/catch 里，失败只 warn + 计数（spec §4 / R3）。
 * 2. **engine 每次事件现取**：worker 侧的 ToolContext 可能早于 runtime 服务就绪，
 *    构造期拿不到 engine，故注入的是取值函数而非实例。
 * 3. **attach 幂等**：ToolContext.init() 与 setContext() 都会调 start()，
 *    重复挂载会让同一响应入库两次。
 */
export class SessionCaptureBridge {
  private context: BrowserContext | null = null;
  private listener: ((response: Response) => void) | null = null;
  private dropped = 0;

  constructor(
    private readonly getEngine: () => CaptureEngine | undefined,
    private readonly opts: SessionCaptureBridgeOptions = {},
    private readonly isSelectedPage?: (page: Page) => boolean,
  ) {}

  attach(context: BrowserContext): void {
    if (this.listener) {
      if (this.context === context) return;
      this.detach();
    }
    const listener = (response: Response): void => {
      void this.ingest(response);
    };
    context.on('response', listener);
    this.context = context;
    this.listener = listener;
  }

  detach(): void {
    if (this.context && this.listener) {
      try {
        this.context.off('response', this.listener);
      } catch {
        // context 已关闭，忽略
      }
    }
    this.context = null;
    this.listener = null;
  }

  /** 摄入失败累计次数（只用于观测与测试）。 */
  getDroppedCount(): number {
    return this.dropped;
  }

  private async ingest(response: Response): Promise<void> {
    // try 必须罩住 getEngine()：首次调用会下钻到
    // RuntimeServices.getCaptureEngine() → ensureSessionStore()
    // → new DatabaseManager(...)，SQLite 打开失败（权限/磁盘满/锁）就在这里抛。
    // 漏罩会让 dropped 计不到，异常还会以 unhandled rejection 逃出
    // void this.ingest() —— 与 MITM 侧 recordExchange 的完全包含不对称。
    // engine 缺失仍走 return，不计入 dropped（那不是故障，是未就绪）。
    // 源头过滤（spec §4）：非选中 tab 的响应在取体前直接丢弃。
    // 放 try 之外：这是「有意过滤」不是「摄入故障」，不进 dropped 计数。
    if (this.isSelectedPage) {
      try {
        if (!this.isSelectedPage(response.frame().page())) return;
      } catch {
        // frame()/page() 抛 = 响应已 dispose，无法归属；保守丢弃，避免全局噪声。
        return;
      }
    }
    try {
      const engine = this.getEngine();
      if (!engine) return;
      const input: CapturedRequestInput = await fromCdpResponse(response, {
        ...(this.opts.now ? {now: this.opts.now} : {}),
        ...(this.captureBodyEnabled() ? {} : {readBody: skipBody}),
      });
      engine.ingestRequest(input);
    } catch (error) {
      this.dropped += 1;
      logger.warn(
        `[SessionCaptureBridge] CDP 响应摄入失败，已丢弃第 ${this.dropped} 条`,
        error,
      );
    }
  }

  private captureBodyEnabled(): boolean {
    return this.opts.captureBody ?? CDP_BODY_CAPTURE_ENABLED;
  }
}
