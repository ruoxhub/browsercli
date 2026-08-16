/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, HTTPResponse, Page} from '../../third_party/index.js';
import type {ReverseTaskHandle} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import type {PageController} from '../collector/PageController.js';
import {evaluateInPageRuntime} from '../debugger/evaluateInPageRuntime.js';

import type {WasmAnalyzer} from './WasmAnalyzer.js';
import {WasmArtifactStore} from './WasmArtifactStore.js';
import {WasmBinaryRegistry} from './WasmBinaryRegistry.js';
import {buildPreloadScript} from './WasmPreloadScript.js';
import type {WasmRuntimeInspector} from './WasmRuntimeInspector.js';
import type {
  WasmDetectionResult,
  WasmModuleRecord,
  WasmRuntimeEvent,
  WasmRuntimeModuleCapture,
} from './WasmTypes.js';

export interface CollectWasmOptions {
  url: string;
  timeout?: number;
  waitAfterLoadMs?: number;
  includeRuntimeEvents?: boolean;
  maxModules?: number;
  captureBase64?: boolean;
}

interface NetworkCaptureEntry {
  url: string;
  contentType?: string;
  bytes: Uint8Array;
  timestamp: number;
}

interface PageRuntimeCaptureState {
  modules?: WasmRuntimeModuleCapture[];
  events?: Array<Omit<WasmRuntimeEvent, 'moduleId'> & {moduleId?: string}>;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_AFTER_LOAD_MS = 1000;
const DEFAULT_MAX_MODULES = 20;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isWasmBinary(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d
  );
}

function cloneRuntimeEvent(event: WasmRuntimeEvent): WasmRuntimeEvent {
  return {
    ...event,
    importKeys: event.importKeys ? [...event.importKeys] : undefined,
    exportKeys: event.exportKeys ? [...event.exportKeys] : undefined,
    requestHeaders: event.requestHeaders
      ? event.requestHeaders.map(entry => ({...entry}))
      : undefined,
    bodySegments: event.bodySegments
      ? event.bodySegments.map(entry => ({...entry}))
      : undefined,
    argsPreview: event.argsPreview ? [...event.argsPreview] : undefined,
    stackSummary: event.stackSummary ? [...event.stackSummary] : undefined,
    memory: event.memory ? event.memory.map(entry => ({...entry})) : undefined,
    resultEntries: event.resultEntries
      ? event.resultEntries.map(entry => ({...entry}))
      : undefined,
    sideEffectHints: event.sideEffectHints
      ? [...event.sideEffectHints]
      : undefined,
  };
}

/**
 * WasmCollector — 协调门面。
 *
 * 策略模块负责具体实现：
 *  - WasmPreloadScript:  注入页面的 WebAssembly 拦截脚本
 *  - WasmBinaryRegistry: 模块 ID/哈希/二进制映射管理
 *  - WasmArtifactStore:  产物持久化
 *
 * 门面保留 collect 主流程、网络响应捕获、运行时状态读取、runtimeEvents 数组
 * 以及公共 getter 委托。
 */
export class WasmCollector {
  private readonly binaryRegistry: WasmBinaryRegistry;
  private readonly artifactStore: WasmArtifactStore;
  private readonly runtimeEvents: WasmRuntimeEvent[] = [];

  constructor(
    private readonly pageController: PageController,
    private readonly analyzer: WasmAnalyzer,
    private readonly runtimeInspector: WasmRuntimeInspector,
  ) {
    this.binaryRegistry = new WasmBinaryRegistry(analyzer);
    this.artifactStore = new WasmArtifactStore(analyzer, runtimeInspector);
  }

  async collect(
    options: CollectWasmOptions,
    task?: ReverseTaskHandle,
    pageOverride?: Page,
  ): Promise<WasmDetectionResult> {
    const page = pageOverride ?? (await this.pageController.getPage());
    const captureBase64 = options.captureBase64 ?? false;
    const runtimeEnabled = options.includeRuntimeEvents !== false;
    const maxModules = options.maxModules ?? DEFAULT_MAX_MODULES;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const waitAfterLoadMs =
      options.waitAfterLoadMs ?? DEFAULT_WAIT_AFTER_LOAD_MS;
    const networkEntries: NetworkCaptureEntry[] = [];
    const pendingResponseCaptures = new Set<Promise<void>>();
    let preloadSession: CDPSession | undefined;
    let preloadIdentifier: string | undefined;

    if (runtimeEnabled) {
      preloadSession = await page.context().newCDPSession(page);
      try {
        await preloadSession.send('Page.enable');
        const preloadResult = (await preloadSession.send(
          'Page.addScriptToEvaluateOnNewDocument',
          {source: buildPreloadScript()},
        )) as {identifier: string};
        preloadIdentifier = preloadResult.identifier;
      } catch (error) {
        await preloadSession.detach().catch(() => undefined);
        throw error;
      }
    }

    const handleResponse = (response: HTTPResponse) => {
      const capture = this.captureNetworkResponse(response, networkEntries);
      pendingResponseCaptures.add(capture);
      void capture.finally(() => pendingResponseCaptures.delete(capture));
    };

    page.on('response', handleResponse);
    try {
      await page.goto(options.url, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      if (waitAfterLoadMs > 0) {
        await wait(waitAfterLoadMs);
      }
      await Promise.allSettled(Array.from(pendingResponseCaptures));

      const runtimeState = runtimeEnabled
        ? await this.readRuntimeCaptureState(page, timeout)
        : {modules: [], events: []};

      const runtimeModuleIds = new Map<string, string>();

      for (const entry of networkEntries) {
        this.binaryRegistry.registerBinary(entry.bytes, {
          sourceUrl: entry.url,
          contentType: entry.contentType,
          loadMethod: 'network',
          timestamp: entry.timestamp,
          source: 'network',
          captureBase64,
        });
      }

      for (const moduleCapture of runtimeState.modules ?? []) {
        if (!moduleCapture.base64) {
          continue;
        }
        const bytes = Uint8Array.from(
          Buffer.from(moduleCapture.base64, 'base64'),
        );
        if (!isWasmBinary(bytes)) {
          continue;
        }
        const record = this.binaryRegistry.registerBinary(bytes, {
          sourceUrl: moduleCapture.sourceUrl,
          loadMethod: moduleCapture.loadMethod,
          timestamp: moduleCapture.timestamp,
          runtimeModuleId: moduleCapture.runtimeModuleId,
          source: 'runtime',
          captureBase64,
        });
        runtimeModuleIds.set(moduleCapture.runtimeModuleId, record.id);
      }

      for (const event of runtimeState.events ?? []) {
        const normalized = cloneRuntimeEvent({
          ...event,
          moduleId:
            event.moduleId ??
            (event.runtimeModuleId
              ? runtimeModuleIds.get(event.runtimeModuleId)
              : undefined),
        });
        this.runtimeEvents.push(normalized);
      }

      this.binaryRegistry.applyExportCallCounts(this.runtimeEvents);

      const modules = this.binaryRegistry.getModules();
      const selectedModules = modules.slice(0, maxModules);
      const selectedIds = new Set(selectedModules.map(module => module.id));
      const selectedEvents = this.runtimeEvents.filter(
        event => !event.moduleId || selectedIds.has(event.moduleId),
      );

      let artifacts: WasmDetectionResult['artifacts'];
      if (task) {
        artifacts = await this.artifactStore.persistArtifacts(
          task,
          modules,
          this.runtimeEvents,
          this.binaryRegistry.bytesByModuleId,
          (moduleId, binPath) => {
            const existing = this.binaryRegistry.modulesById.get(moduleId);
            if (existing) {
              this.binaryRegistry.modulesById.set(moduleId, {
                ...existing,
                artifactPath: binPath,
              });
            }
          },
        );
      }

      return {
        modules: selectedModules,
        runtimeEvents: selectedEvents.map(event => cloneRuntimeEvent(event)),
        totalModules: modules.length,
        totalRuntimeEvents: this.runtimeEvents.length,
        collectedAt: new Date().toISOString(),
        artifacts,
      };
    } finally {
      page.off('response', handleResponse);
      if (preloadSession) {
        if (preloadIdentifier) {
          await preloadSession
            .send('Page.removeScriptToEvaluateOnNewDocument', {
              identifier: preloadIdentifier,
            })
            .catch(() => undefined);
        }
        await preloadSession.detach().catch(() => undefined);
      }
    }
  }

  getModules(): WasmModuleRecord[] {
    return this.binaryRegistry.getModules();
  }

  getModuleById(moduleId: string): WasmModuleRecord | undefined {
    return this.binaryRegistry.getModuleById(moduleId);
  }

  getModuleBytes(moduleId: string): Uint8Array | undefined {
    return this.binaryRegistry.getModuleBytes(moduleId);
  }

  getRuntimeEvents(moduleId?: string): WasmRuntimeEvent[] {
    return this.runtimeEvents
      .filter(event => !moduleId || event.moduleId === moduleId)
      .map(event => cloneRuntimeEvent(event));
  }

  private async captureNetworkResponse(
    response: HTTPResponse,
    sink: NetworkCaptureEntry[],
  ): Promise<void> {
    try {
      const url = response.url();
      const headers = response.headers();
      const contentType =
        typeof headers['content-type'] === 'string'
          ? headers['content-type']
          : undefined;
      const looksLikeWasm =
        (contentType?.toLowerCase().includes('application/wasm') ?? false) ||
        url.toLowerCase().endsWith('.wasm');

      if (!looksLikeWasm) {
        return;
      }

      const buffer = await response.body();
      const bytes = Uint8Array.from(buffer);
      if (!isWasmBinary(bytes)) {
        logger.debug(
          `[WasmCollector] Ignored non-wasm response body from ${url}`,
        );
        return;
      }

      sink.push({
        url,
        contentType,
        bytes,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.warn('[WasmCollector] Failed to capture wasm response', error);
    }
  }

  private async readRuntimeCaptureState(
    page: Page,
    timeoutMs: number,
  ): Promise<PageRuntimeCaptureState> {
    try {
      const expression = `(() => {
        const capture = globalThis.__jshookWasmCapture__;
        if (!capture) {
          return {modules: [], events: []};
        }
        return JSON.parse(JSON.stringify(capture));
      })()`;
      return await evaluateInPageRuntime<PageRuntimeCaptureState>(
        page.mainFrame(),
        expression,
        timeoutMs,
      );
    } catch (error) {
      logger.warn(
        '[WasmCollector] Failed to read runtime capture state',
        error,
      );
      return {modules: [], events: []};
    }
  }
}
