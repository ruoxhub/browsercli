/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BrowserPage — 单个浏览器标签页的领域聚合根（ADR-0008）
 *
 * 收敛原分散在 BrowserContextProvider / DebuggerContextProvider / CollectorContextProvider
 * 与全局单例中的全部按页状态与控制器，并在页面关闭时统一释放：
 * - Frame 选择与存活回退
 * - Dialog 监听与状态
 * - 网络/CPU 节流及页面超时配置
 * - DebuggerManager + CDPSession
 * - NetworkMockManager & LogpointManager
 * - 单页运行时 Hook 捕获缓冲（PageHookStore）
 * - 快照采集、事件等待、网络/控制台/WS 查询视图
 */

import type {CDPSession, ConsoleMessage, Dialog, Frame, Page} from 'patchright';

import {
  startCdpScreenRecording,
  type ScreenRecorderData,
  type ScreenRecordingHandle,
  type StartScreenRecordingOptions,
} from '../modules/browser/CdpScreenRecording.js';
import {getPersistentCdpSession} from '../modules/browser/cdpUtils.js';
import {
  applyPageEmulation,
  type EmulateOptions,
} from '../modules/browser/EmulationManager.js';
import {
  WaitForHelper,
  type WaitForEventsOptions,
  type WaitForEventsResult,
} from '../modules/browser/WaitForHelper.js';
import {DebuggerManager} from '../modules/debugger/DebuggerManager.js';
import {
  LogpointManager,
  type Logpoint,
  type LogpointOptions,
} from '../modules/debugger/LogpointManager.js';
import {HookStore, type HookDataRecord} from '../modules/hook/index.js';
import {
  NetworkMockManager,
  type NetworkMockFilter,
  type NetworkMockInput,
  type NetworkOverride,
} from '../modules/network/NetworkMockManager.js';
import type {WebSocketData} from '../modules/network/NetworkTypes.js';
import type {
  ExtendedSnapshotOptions,
  PageSnapshotManager,
} from '../modules/snapshot/PageSnapshotManager.js';
import type {TextSnapshotResult} from '../modules/snapshot/types.js';
import type {HTTPRequest} from '../third_party/index.js';
import type {ContextPage} from '../tools/ToolDefinition.js';

import type {CollectorContextProvider} from './context/CollectorContextProvider.js';
import type {PageHealthTracker} from './context/PageHealthTracker.js';

const DEFAULT_TIMEOUT = 5_000;
const NAVIGATION_TIMEOUT = 10_000;

export function getNetworkMultiplierFromString(
  condition: string | null,
): number {
  switch (condition) {
    case 'Fast 4G':
      return 1;
    case 'Slow 4G':
      return 2.5;
    case 'Fast 3G':
      return 5;
    case 'Slow 3G':
      return 10;
    default:
      return 1;
  }
}

export interface BrowserPageDeps {
  collectors: CollectorContextProvider;
  snapshotManager: PageSnapshotManager;
  healthTracker: PageHealthTracker;
  maxHookRecords?: number;
}

export class BrowserPage implements ContextPage {
  readonly id: string;
  readonly rawPage: Page;

  private readonly collectors: CollectorContextProvider;
  private readonly snapshotManager: PageSnapshotManager;
  private readonly healthTracker: PageHealthTracker;

  private selectedFrame: Frame | null = null;
  private dialog?: Dialog;
  private dialogListenerAttached = false;
  private networkConditions: string | null = null;
  private cpuThrottlingRate = 1;

  private networkMockManager?: NetworkMockManager;
  private logpointManager?: LogpointManager;
  private debuggerManager?: DebuggerManager;
  private debuggerSession?: CDPSession;
  private readonly hookStore: HookStore<HookDataRecord>;
  private screenRecorder: ScreenRecorderData | null = null;
  private focusEmulationRequested = false;
  private disposed = false;

  private readonly dialogHandler = (dialog: Dialog): void => {
    this.dialog = dialog;
  };

  constructor(id: string, rawPage: Page, deps: BrowserPageDeps) {
    this.id = id;
    this.rawPage = rawPage;
    this.collectors = deps.collectors;
    this.snapshotManager = deps.snapshotManager;
    this.healthTracker = deps.healthTracker;
    this.hookStore = new HookStore<HookDataRecord>(deps.maxHookRecords ?? 1000);

    this.attachDialogListener();
    if (typeof rawPage.once === 'function') {
      rawPage.once('close', () => {
        void this.dispose();
      });
    }
  }

  isClosed(): boolean {
    if (this.disposed) return true;
    try {
      return typeof this.rawPage.isClosed === 'function'
        ? this.rawPage.isClosed()
        : false;
    } catch {
      return true;
    }
  }

  // ─── Frame 管理 ─────────────────────────────────────

  getSelectedFrame(): Frame {
    if (this.selectedFrame) {
      try {
        if (
          typeof this.rawPage.frames === 'function' &&
          this.rawPage.frames().includes(this.selectedFrame)
        ) {
          return this.selectedFrame;
        }
      } catch {
        // frames() 在页面关闭时可能抛错，按失效回退
      }
      this.selectedFrame = null;
    }

    const mainFrame =
      typeof this.rawPage.mainFrame === 'function'
        ? this.rawPage.mainFrame()
        : null;
    if (!mainFrame) {
      throw new Error('没有可用的 Frame，可能页面未选中或已关闭');
    }
    return mainFrame;
  }

  getSelectedFrameOrNull(): Frame | null {
    try {
      return this.getSelectedFrame();
    } catch {
      return null;
    }
  }

  selectFrame(frame: Frame | null): void {
    this.selectedFrame = frame;
  }

  selectFrameByIdx(frameIdx: number): Frame | null {
    const frames = this.rawPage.frames();
    if (frameIdx < 0 || frameIdx >= frames.length) return null;
    this.selectedFrame = frames[frameIdx]!;
    return this.selectedFrame;
  }

  // ─── Dialog 管理 ────────────────────────────────────

  attachDialogListener(): void {
    if (this.dialogListenerAttached) return;
    if (typeof this.rawPage.on === 'function') {
      this.rawPage.on('dialog', this.dialogHandler);
      this.dialogListenerAttached = true;
    }
  }

  detachDialogListener(): void {
    if (!this.dialogListenerAttached) return;
    try {
      if (typeof this.rawPage.off === 'function') {
        this.rawPage.off('dialog', this.dialogHandler);
      }
    } catch {
      // ignore
    }
    this.dialogListenerAttached = false;
  }

  getDialog(): Dialog | undefined {
    return this.dialog;
  }

  clearDialog(): void {
    this.dialog = undefined;
  }

  // ─── 网络/CPU 节流与超时 ─────────────────────────────

  setNetworkConditions(conditions: string | null): void {
    this.networkConditions = conditions;
    this.updateTimeouts();
  }

  getNetworkConditions(): string | null {
    return this.networkConditions;
  }

  setCpuThrottlingRate(rate: number): void {
    this.cpuThrottlingRate = rate;
    this.updateTimeouts();
  }

  getCpuThrottlingRate(): number {
    return this.cpuThrottlingRate;
  }

  updateTimeouts(): void {
    try {
      if (typeof this.rawPage.setDefaultTimeout === 'function') {
        this.rawPage.setDefaultTimeout(
          DEFAULT_TIMEOUT * this.cpuThrottlingRate,
        );
      }
      if (typeof this.rawPage.setDefaultNavigationTimeout === 'function') {
        this.rawPage.setDefaultNavigationTimeout(
          NAVIGATION_TIMEOUT *
            getNetworkMultiplierFromString(this.networkConditions),
        );
      }
    } catch {
      // 页面可能已关闭
    }
  }

  async emulate(options: EmulateOptions): Promise<void> {
    await applyPageEmulation(this.rawPage, options, {
      setNetworkConditions: c => this.setNetworkConditions(c),
      setCpuThrottlingRate: r => this.setCpuThrottlingRate(r),
    });
  }

  async waitForEventsAfterAction(
    action: (signal: AbortSignal) => Promise<unknown>,
    options?: WaitForEventsOptions,
  ): Promise<WaitForEventsResult> {
    const helper = new WaitForHelper(
      this.rawPage,
      this.cpuThrottlingRate,
      getNetworkMultiplierFromString(this.networkConditions),
    );
    return await helper.waitForEventsAfterAction(action, options);
  }

  async waitForTextOnPage(params: {
    text: string | string[];
    timeout?: number;
    visible?: boolean;
  }): Promise<void> {
    const texts = Array.isArray(params.text) ? params.text : [params.text];
    if (texts.length === 0) {
      throw new Error('At least one text string is required.');
    }
    const timeout = params.timeout ?? 5_000;
    const visibleOnly = params.visible ?? false;
    await this.rawPage.waitForFunction(
      ({
        targets,
        requireVisible,
      }: {
        targets: string[];
        requireVisible: boolean;
      }) => {
        const isVisible = (el: Element): boolean => {
          const style = window.getComputedStyle(el);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
          ) {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const checkNodeText = (node: Element): boolean => {
          const ariaLabel = node.getAttribute('aria-label');
          const title = node.getAttribute('title');
          const alt = node.getAttribute('alt');
          const rawText = requireVisible
            ? ((node as HTMLElement).innerText ?? node.textContent ?? '')
            : (node.textContent ?? '');
          for (const target of targets) {
            if (
              ariaLabel === target ||
              title === target ||
              alt === target ||
              rawText.includes(target)
            ) {
              if (!requireVisible || isVisible(node)) {
                return true;
              }
            }
          }
          return false;
        };

        if (!document.body) {
          return false;
        }
        if (!requireVisible) {
          const bodyText = document.body.textContent ?? '';
          if (targets.some(t => bodyText.includes(t))) {
            return true;
          }
        }
        const elements = document.body.querySelectorAll('*');
        for (const el of Array.from(elements)) {
          if (checkNodeText(el)) {
            return true;
          }
        }
        return checkNodeText(document.body);
      },
      {targets: texts, requireVisible: visibleOnly},
      {timeout},
    );
  }

  async bringToFront(): Promise<void> {
    await this.rawPage.bringToFront();
  }

  /**
   * 为后台选中页启用 CDP 焦点模拟（对齐 chrome-devtools-mcp 的 emulateFocusedPage(true)）。
   * 不切换浏览器前台标签，同时避免后台页因未聚焦被节流或影响交互。
   */
  ensureFocusEmulation(): void {
    if (this.disposed || this.focusEmulationRequested) {
      return;
    }
    const ctx =
      typeof this.rawPage.context === 'function'
        ? this.rawPage.context()
        : undefined;
    if (!ctx || typeof ctx.newCDPSession !== 'function') {
      return;
    }
    this.focusEmulationRequested = true;
    void getPersistentCdpSession(this.rawPage)
      .then(client =>
        client.send('Emulation.setFocusEmulationEnabled', {enabled: true}),
      )
      .catch(() => {
        this.focusEmulationRequested = false;
      });
  }

  // ─── Debugger 管理 ──────────────────────────────────

  getExistingDebugger(): DebuggerManager | undefined {
    return this.debuggerManager?.isEnabled() ? this.debuggerManager : undefined;
  }

  async ensureDebugger(): Promise<DebuggerManager> {
    if (this.debuggerManager?.isEnabled()) {
      return this.debuggerManager;
    }

    const client = await this.rawPage.context().newCDPSession(this.rawPage);
    const manager = new DebuggerManager({
      getActivePage: async () => this.rawPage,
    });
    await manager.enable(client);

    this.debuggerManager = manager;
    this.debuggerSession = client;
    return manager;
  }

  async disposeDebugger(): Promise<void> {
    const manager = this.debuggerManager;
    this.debuggerManager = undefined;
    if (manager) {
      try {
        await manager.disable();
      } catch {
        // Ignore cleanup errors when page/session is already gone.
      }
    }

    const session = this.debuggerSession;
    this.debuggerSession = undefined;
    if (session) {
      try {
        await session.detach();
      } catch {
        // Ignore cleanup errors when page/session is already gone.
      }
    }
  }

  // ─── Network Mock / Logpoint / HookStore ────────────

  getNetworkMockManager(): NetworkMockManager {
    if (!this.networkMockManager) {
      this.networkMockManager = new NetworkMockManager(this.rawPage);
    }
    return this.networkMockManager;
  }

  async mockNetwork(input: NetworkMockInput): Promise<NetworkOverride> {
    return await this.getNetworkMockManager().mock(input);
  }

  listNetworkMocks(filter?: NetworkMockFilter): NetworkOverride[] {
    return this.getNetworkMockManager().list(filter);
  }

  async removeNetworkMocks(filter: NetworkMockFilter): Promise<number> {
    return await this.getNetworkMockManager().remove(filter);
  }

  getLogpointManager(): LogpointManager {
    if (!this.logpointManager) {
      this.logpointManager = new LogpointManager();
    }
    return this.logpointManager;
  }

  async setLogpoints(desired: LogpointOptions[]): Promise<Logpoint[]> {
    const debuggerManager = await this.ensureDebugger();
    return await this.getLogpointManager().setLogpoints(
      debuggerManager,
      desired,
    );
  }

  getLogpoints(): Logpoint[] {
    return this.getLogpointManager().getLogpoints();
  }

  getHookStore(): HookStore<HookDataRecord> {
    return this.hookStore;
  }

  // ─── Screencast 管理 ────────────────────────────────

  getScreenRecorder(): ScreenRecorderData | null {
    return this.screenRecorder;
  }

  setScreenRecorder(data: ScreenRecorderData | null): void {
    this.screenRecorder = data;
  }

  async startScreenRecording(
    options: StartScreenRecordingOptions,
  ): Promise<ScreenRecordingHandle> {
    return await startCdpScreenRecording(this.rawPage, options);
  }

  // ─── 快照与观测数据 ─────────────────────────────────

  async captureSnapshot(
    options?: ExtendedSnapshotOptions,
  ): Promise<TextSnapshotResult> {
    return await this.snapshotManager.capture(this.rawPage, options);
  }

  getNetworkRequests(includePreserved = false): HTTPRequest[] {
    return this.collectors.getNetworkRequests(this.rawPage, includePreserved);
  }

  clearNetworkRequests(): void {
    this.collectors.clearNetworkRequests(this.rawPage);
  }

  async ensureConsoleEnabled(): Promise<void> {
    await this.collectors.ensureConsoleEnabled(this.rawPage);
  }

  getConsoleData(includePreserved = false): Array<ConsoleMessage | Error> {
    return this.collectors.getConsoleData(this.rawPage, includePreserved);
  }

  getWebSocketConnections(includePreserved = false): WebSocketData[] {
    return this.collectors.getWebSocketConnections(
      this.rawPage,
      includePreserved,
    );
  }

  recordHealthy(): void {
    this.healthTracker.recordSuccess(this.id);
  }

  recordTimeout(error?: string): void {
    this.healthTracker.recordTimeout(this.id, error);
  }

  // ─── 统一释放 ───────────────────────────────────────

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.detachDialogListener();
    this.dialog = undefined;
    this.selectedFrame = null;

    if (this.screenRecorder) {
      const {recorder, timer} = this.screenRecorder;
      this.screenRecorder = null;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      await recorder.stop().catch(() => undefined);
    }

    if (this.networkMockManager) {
      await this.networkMockManager.dispose().catch(() => undefined);
      this.networkMockManager = undefined;
    }

    if (this.logpointManager) {
      this.logpointManager.clear();
      this.logpointManager = undefined;
    }

    await this.disposeDebugger();
    this.hookStore.clear();
    this.healthTracker.clear(this.id);
  }
}
