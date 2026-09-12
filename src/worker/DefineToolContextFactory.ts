/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {TrafficSummary} from '../formatters/websocketFormatter.js';
import type {Context} from '../tools/ToolDefinition.js';
import type {TraceResult} from '../trace-processing/parse.js';

import {wrapFrameWithTimeout} from './timeoutUtils.js';
import type {ToolContextProvider} from './ToolContext.js';

export class DefineToolContextFactory {
  private readonly trafficSummaryCache = new Map<number, TrafficSummary>();

  constructor(private readonly provider: ToolContextProvider) {}

  create(): Context {
    const provider = this.provider;
    return {
      getBrowserTargetInspector: () => provider.getBrowserTargetInspector(),
      isRunningPerformanceTrace: () => provider.isRunningPerformanceTrace(),
      setIsRunningPerformanceTrace: (x: boolean) =>
        provider.setIsRunningPerformanceTrace(x),
      recordedTraces: () => provider.recordedTraces() as TraceResult[],
      storeTraceRecording: (result: TraceResult) =>
        provider.storeTraceRecording(result),
      getSelectedPage: () => {
        const page = provider.getSelectedPage();
        if (!page) throw new Error('没有选中的页面');
        return page;
      },
      getBrowserContext: () => provider.getContext(),
      getPersistentHookRegistry: () => provider.getPersistentHookRegistry(),
      getDialog: () => provider.getDialog(),
      clearDialog: () => provider.clearDialog(),
      getPageByIdx: idx => provider.getPageByIdx(idx),
      getPageId: page => provider.getPageId(page),
      resolvePage: selector => provider.resolvePage(selector),
      isPageSelected: page => provider.getSelectedPage() === page,
      newPage: () => provider.newPage(),
      closePage: async (pageIdx: number) => {
        const page = provider.getPageByIdx(pageIdx);
        await page.close();
        await provider.syncPages();
      },
      selectPage: page => provider.selectPage(page),
      bringPageToFront: page => provider.bringPageToFront(page),
      syncPageContext: page => provider.syncPageContext(page),
      getPages: () => provider.getPages(),
      isBrowserConnected: () => provider.isBrowserConnected(),
      ensureConnectedBrowser: () => provider.ensureConnectedBrowser(),
      getSelectedFrame: () => {
        const frame =
          provider.getSelectedFrame() ??
          provider.getSelectedPage()?.mainFrame();
        if (!frame) {
          throw new Error('没有可用的 Frame，可能页面未选中或已关闭');
        }
        return wrapFrameWithTimeout(frame);
      },
      selectFrame: frame => provider.setSelectedFrame(frame),
      resetSelectedFrame: () => provider.setSelectedFrame(null),
      setNetworkConditions: conditions =>
        provider.setNetworkConditions(conditions),
      setCpuThrottlingRate: rate => provider.setCpuThrottlingRate(rate),
      saveTemporaryFile: async (_data, _mimeType) => {
        throw new Error('saveTemporaryFile not supported in worker mode');
      },
      saveFile: async (_data, _filename) => {
        throw new Error('saveFile not supported in worker mode');
      },
      waitForEventsAfterAction: async action => {
        await action();
      },
      waitForTextOnPage: async _params => {
        throw new Error('waitForTextOnPage not supported in worker mode');
      },
      getDevToolsData: () => provider.getDevToolsData(),
      resolveCdpRequestId: cdpRequestId =>
        provider.resolveCdpRequestId(cdpRequestId),
      getDebuggerContext: () => provider.getDebuggerContext(),
      getExistingDebuggerContext: () => provider.getExistingDebuggerContext(),
      getRequestInitiator: request => provider.getRequestInitiator(request),
      getRequestInitiatorById: _requestId => undefined,
      getNetworkRequestById: reqid => provider.getNetworkRequestById(reqid),
      getNetworkRequests: includePreservedRequests =>
        provider.getNetworkRequests(includePreservedRequests),
      getWebSocketConnections: includePreservedData =>
        provider.getWebSocketConnections(includePreservedData),
      getWebSocketById: wsid => provider.getWebSocketConnectionById(wsid),
      getWebSocketStableId: ws => provider.getWebSocketStableId(ws),
      cacheTrafficSummary: (wsid, summary) => {
        this.trafficSummaryCache.set(wsid, summary);
      },
      getCachedTrafficSummary: wsid => this.trafficSummaryCache.get(wsid),
    };
  }
}
