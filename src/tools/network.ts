/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';

import {normalizePageId} from '../modules/browser/PageIdentity.js';
import {
  formatNetworkOverrides,
  type NetworkMockInput,
  validateUrlPattern,
} from '../modules/network/NetworkMockManager.js';
import {
  type AnalyzeWebSocketMessagesParams,
  FILTERABLE_RESOURCE_TYPES,
  type GetWebSocketMessageParams,
  type GetWebSocketMessagesParams,
  type RequestInitiator,
  type WebSocketConnection,
  type WebSocketData,
  type WebSocketDirection,
  type WebSocketFrame,
} from '../modules/network/NetworkTypes.js';
import {
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  type ResourceType,
  type WebSocketClosedEvent,
  type WebSocketCreatedEvent,
  type WebSocketFrameReceivedEvent,
  type WebSocketFrameSentEvent,
  zod,
} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';
import {validateOutputPath} from '../utils/fsSafe.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {definePageTool} from './ToolDefinition.js';

// ─── WebSocketCollector.ts ───────────────────────────────

const stableIdSymbol = Symbol('wsStableIdSymbol');

type WebSocketDataWithId = WebSocketData & {
  [stableIdSymbol]?: number;
};

function createIdGenerator() {
  let i = 1;
  return () => {
    if (i === Number.MAX_SAFE_INTEGER) {
      i = 0;
    }
    return i++;
  };
}

/**
 * Collector for WebSocket connections and messages.
 * Listens to CDP Network events for WebSocket activity.
 */
export class WebSocketCollector {
  #browser: Browser;

  /**
   * Storage: Page -> Array of navigations -> Array of WebSocket connections.
   * Newer navigations come first.
   */
  #storage = new WeakMap<Page, WebSocketDataWithId[][]>();

  /**
   * Quick lookup: Page -> requestId -> WebSocketData
   */
  #connectionMap = new WeakMap<Page, Map<string, WebSocketDataWithId>>();

  /**
   * ID generator per page for stable IDs.
   */
  #idGenerators = new WeakMap<Page, () => number>();

  /**
   * CDP listeners per page.
   */
  #cdpListeners = new WeakMap<
    Page,
    {
      onCreated: (event: WebSocketCreatedEvent) => void;
      onFrameSent: (event: WebSocketFrameSentEvent) => void;
      onFrameReceived: (event: WebSocketFrameReceivedEvent) => void;
      onClosed: (event: WebSocketClosedEvent) => void;
      onFrameNavigated: () => void;
    }
  >();

  #maxNavigationSaved = 3;
  #boundContexts = new Set<BrowserContext>();

  #onPageCreated = (page: Page) => {
    this.addPage(page);
    page.once('close', () => {
      this.#cleanupPage(page);
    });
  };

  constructor(browser: Browser, _includeAllPages?: boolean) {
    this.#browser = browser;
  }

  async init() {
    const pages: Page[] = [];
    for (const context of this.#browser.contexts()) {
      if (!this.#boundContexts.has(context)) {
        this.#boundContexts.add(context);
        context.on('page', this.#onPageCreated);
      }
      pages.push(...context.pages());
    }

    for (const page of pages) {
      this.addPage(page);
      page.once('close', () => {
        this.#cleanupPage(page);
      });
    }
  }

  dispose() {
    for (const context of this.#boundContexts) {
      context.off('page', this.#onPageCreated);
    }
    this.#boundContexts.clear();
  }

  addPage(page: Page) {
    if (this.#storage.has(page)) {
      return;
    }

    const idGenerator = createIdGenerator();
    this.#idGenerators.set(page, idGenerator);

    const storedLists: WebSocketDataWithId[][] = [[]];
    this.#storage.set(page, storedLists);
    this.#connectionMap.set(page, new Map());

    this.#setupCdpListeners(page);
  }

  #setupCdpListeners(page: Page): void {
    // @ts-expect-error _client is internal Puppeteer API
    const client = page._client() as CDPSession;

    const connectionMap = this.#connectionMap.get(page)!;
    const idGenerator = this.#idGenerators.get(page)!;

    const onCreated = (event: unknown): void => {
      const e = event as WebSocketCreatedEvent & {
        initiator?: RequestInitiator;
      };
      // 剪裁深层异步调用栈，避免内存随长连接或持续抓包膨胀（详见 ADR-0001）
      if (e.initiator?.stack) {
        delete e.initiator.stack.parent;
      }
      const wsData: WebSocketDataWithId = {
        connection: {
          requestId: e.requestId,
          url: e.url,
          initiator: e.initiator,
          status: 'connecting',
          createdAt: Date.now(),
        },
        frames: [],
      };
      wsData[stableIdSymbol] = idGenerator();

      connectionMap.set(e.requestId, wsData);

      const navigations = this.#storage.get(page);
      if (navigations) {
        navigations[0].push(wsData);
      }

      // Mark as open once created (CDP doesn't have a separate open event for ws)
      wsData.connection.status = 'open';
    };

    const recordFrame = (
      direction: WebSocketDirection,
      event: unknown,
    ): void => {
      const e = event as {
        requestId: string;
        timestamp: number;
        response: {opcode: number; payloadData: string};
      };
      const wsData = connectionMap.get(e.requestId);
      if (!wsData) {
        return;
      }

      wsData.frames.push({
        requestId: e.requestId,
        direction,
        timestamp: e.timestamp * 1000,
        opcode: e.response.opcode,
        payloadData: e.response.payloadData,
      });
    };

    const onFrameSent = (event: unknown): void => recordFrame('sent', event);
    const onFrameReceived = (event: unknown): void =>
      recordFrame('received', event);

    const onClosed = (event: WebSocketClosedEvent): void => {
      const wsData = connectionMap.get(event.requestId);
      if (!wsData) {
        return;
      }

      wsData.connection.status = 'closed';
      wsData.connection.closedAt = event.timestamp * 1000;
    };

    const onFrameNavigated = (): void => {
      this.#splitAfterNavigation(page);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('Network.webSocketCreated', onCreated as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('Network.webSocketFrameSent', onFrameSent as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('Network.webSocketFrameReceived', onFrameReceived as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('Network.webSocketClosed', onClosed as any);
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        onFrameNavigated();
      }
    });

    this.#cdpListeners.set(page, {
      onCreated,
      onFrameSent,
      onFrameReceived,
      onClosed,
      onFrameNavigated,
    });
  }

  #splitAfterNavigation(page: Page): void {
    const navigations = this.#storage.get(page);
    if (!navigations) {
      return;
    }

    // Add a new navigation
    navigations.unshift([]);
    navigations.splice(this.#maxNavigationSaved);

    // Reset connection map for new navigation
    this.#connectionMap.set(page, new Map());
  }

  #cleanupPage(page: Page): void {
    const listeners = this.#cdpListeners.get(page);
    if (listeners) {
      try {
        // @ts-expect-error _client is internal Puppeteer API
        const client = page._client() as CDPSession;
        /* eslint-disable @typescript-eslint/no-explicit-any */
        client.off('Network.webSocketCreated', listeners.onCreated as any);
        client.off('Network.webSocketFrameSent', listeners.onFrameSent as any);
        client.off(
          'Network.webSocketFrameReceived',
          listeners.onFrameReceived as any,
        );
        client.off('Network.webSocketClosed', listeners.onClosed as any);
        /* eslint-enable @typescript-eslint/no-explicit-any */
      } catch {
        // Page might already be closed
      }
    }

    this.#cdpListeners.delete(page);
    this.#storage.delete(page);
    this.#connectionMap.delete(page);
    this.#idGenerators.delete(page);
  }

  /**
   * Get all WebSocket connections for a page.
   */
  getData(page: Page, includePreservedData?: boolean): WebSocketData[] {
    const navigations = this.#storage.get(page);
    if (!navigations) {
      return [];
    }

    if (!includePreservedData) {
      return navigations[0] ?? [];
    }

    const data: WebSocketData[] = [];
    for (let index = this.#maxNavigationSaved; index >= 0; index--) {
      if (navigations[index]) {
        data.push(...navigations[index]);
      }
    }
    return data;
  }

  /**
   * Get stable ID for a WebSocket connection.
   */
  getIdForResource(resource: WebSocketDataWithId): number {
    return resource[stableIdSymbol] ?? -1;
  }

  /**
   * Get WebSocket connection by stable ID.
   */
  getById(page: Page, stableId: number): WebSocketData {
    const navigations = this.#storage.get(page);
    if (!navigations) {
      throw new Error('No WebSocket connections found for selected page');
    }

    for (const navigation of navigations) {
      const item = navigation.find(ws => ws[stableIdSymbol] === stableId);
      if (item) {
        return item;
      }
    }

    throw new Error('WebSocket connection not found for selected page');
  }

  /**
   * Find a WebSocket connection matching the filter.
   */
  find(
    page: Page,
    filter: (item: WebSocketDataWithId) => boolean,
  ): WebSocketDataWithId | undefined {
    const navigations = this.#storage.get(page);
    if (!navigations) {
      return undefined;
    }

    for (const navigation of navigations) {
      const item = navigation.find(filter);
      if (item) {
        return item;
      }
    }
    return undefined;
  }
}

// ─── analyzeMessages.ts ──────────────────────────────────

const DIRECTION_OPTIONS: readonly ['sent', 'received', 'both'] = [
  'sent',
  'received',
  'both',
];

export const analyzeWebSocketMessages = definePageTool({
  name: 'analyze_websocket_messages',
  description: `分析 WebSocket 消息并按模式/指纹分组。对于理解直播等场景中的二进制/protobuf 消息类型至关重要。返回每种消息类型的统计信息与样本索引。`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod.number().describe('要分析的 WebSocket 连接的 wsid。'),
    direction: zod
      .enum(DIRECTION_OPTIONS)
      .optional()
      .describe('仅分析该方向的消息。'),
  },
  handler: async (request, response, context) => {
    const result = await context.getNetworkModule!().analyzeWebSocketMessages(
      context.getNetworkServices!(),
      request.params as AnalyzeWebSocketMessagesParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'analyze_websocket_messages',
    });
  },
});

// ─── clearNetworkRequests.ts ─────────────────────────────

export const clearNetworkRequests = definePageTool({
  name: 'clear_network_requests',
  description:
    '清空当前选中页面（或指定页面）的缓存网络请求。清空后，list_network_requests 返回的请求列表将为空，稳定的请求 ID 将从 1 重新编号。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    targetPageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('浏览器页面索引。省略时使用当前活动页面。'),
    targetPageId: zod
      .string()
      .min(1)
      .optional()
      .describe('稳定浏览器页面 ID。可与 targetPageIdx 同时提供以校验一致性。'),
  },
  handler: async (request, response, context) => {
    const {pageId, targetPageId} = request.params;
    if (
      pageId &&
      targetPageId &&
      normalizePageId(pageId) !== normalizePageId(targetPageId)
    ) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        `pageId (${pageId}) 与 targetPageId (${targetPageId}) 指向不同页面`,
        {toolName: 'clear_network_requests', pageId, targetPageId},
      );
    }
    const result = context.getNetworkModule!().clearRequests(
      context.getNetworkServices!(),
      request.params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'clear_network_requests',
    });
  },
});

// ─── getMessage.ts ───────────────────────────────────────

export const getWebSocketMessage = definePageTool({
  name: 'get_websocket_message',
  description: `按帧索引获取单条 WebSocket 消息。请先使用 get_websocket_messages 或 analyze_websocket_messages 找到帧索引。`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod.number().describe('WebSocket 连接的 wsid。'),
    frameIndex: zod
      .number()
      .int()
      .min(0)
      .describe('要获取的帧索引（从 0 开始）。'),
    decode: zod
      .enum(['auto', 'protobuf', 'json', 'raw'])
      .optional()
      .describe(
        '解码模式：auto 自动识别，protobuf 按 protobuf 解析，json 提取 JSON，raw 原样。',
      ),
  },
  handler: async (request, response, context) => {
    const result = context.getNetworkModule!().getWebSocketMessage(
      context.getNetworkServices!(),
      request.params as GetWebSocketMessageParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'get_websocket_message',
    });
  },
});

// ─── getMessages.ts ──────────────────────────────────────

export const getWebSocketMessages = definePageTool({
  name: 'get_websocket_messages',
  description: `获取 WebSocket 连接的消息。重要：对于二进制/protobuf 消息（如直播流），请先使用 analyze_websocket_messages 理解消息类型，再用 groupId 参数筛选特定类型。默认模式仅显示摘要。`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod.number().describe('WebSocket 连接的 wsid。'),
    direction: zod
      .enum(DIRECTION_OPTIONS)
      .optional()
      .describe(
        '按方向过滤："sent"（发送）、"received"（接收）或 "both"（合并发送与接收，缺省等价于不过滤）。',
      ),
    groupId: zod
      .string()
      .optional()
      .describe(
        '按组 ID（A、B、C……）过滤。请先从 analyze_websocket_messages 获取组 ID。',
      ),
    pageSize: zod
      .number()
      .int()
      .positive()
      .default(10)
      .optional()
      .describe('每页消息数。默认 10。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('页码（从 0 开始）。'),
    show_content: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        '设为 true 显示完整消息负载。默认 false（仅摘要），以避免输出过大的二进制内容。',
      ),
  },
  handler: async (request, response, context) => {
    const raw = request.params;
    const params: GetWebSocketMessagesParams = {
      wsid: raw.wsid,
      direction: raw.direction,
      groupId: raw.groupId,
      pageSize: raw.pageSize,
      pageIdx: raw.pageIdx,
      showContent: (raw as Record<string, unknown>).show_content as
        | boolean
        | undefined,
    };
    const result = await context.getNetworkModule!().getWebSocketMessages(
      context.getNetworkServices!(),
      params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'get_websocket_messages',
    });
  },
});

// ─── getNetworkRequest.ts ────────────────────────────────

export const getNetworkRequest = definePageTool({
  name: 'get_network_request',
  description:
    '按可选的 reqid 获取网络请求；若省略则返回 DevTools Network 面板中当前选中的请求。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    reqid: zod
      .number()
      .optional()
      .describe(
        '网络请求的 reqid。省略时返回 DevTools Network 面板中当前选中的请求。',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的响应体最大长度。默认 300 字符。'),
    fullBody: zod
      .boolean()
      .optional()
      .describe('返回完整响应体，跳过默认截断。'),
    saveTo: zod
      .string()
      .optional()
      .describe('将响应体保存到指定文件路径，返回 savedPath，不占用响应内存。'),
    requestFilePath: zod
      .string()
      .optional()
      .describe('将请求体（postData）保存到指定文件路径。'),
    responseFilePath: zod
      .string()
      .optional()
      .describe('将响应体保存到指定文件路径（与 saveTo 等价）。'),
  },
  handler: async (request, response, context) => {
    const result = await context.getNetworkModule!().getRequest(
      context.getNetworkServices!(),
      request.params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'get_network_request',
    });
  },
});

// ─── listConnections.ts ──────────────────────────────────

export const listWebSocketConnections = definePageTool({
  name: 'list_websocket_connections',
  description: `列出所有 WebSocket 连接。获取 wsid 后，请先使用 analyze_websocket_messages(wsid) 理解消息模式，再查看单条消息。`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的最大连接数。省略时返回全部连接。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('返回的页码（从 0 开始）。省略时返回第一页。'),
    urlFilter: zod
      .string()
      .optional()
      .describe(
        '按 URL 子串过滤连接（大小写不敏感，非正则；例如 "wss://" 或 "chat"）。',
      ),
    includePreservedConnections: zod
      .boolean()
      .default(false)
      .optional()
      .describe('设为 true 可返回最近 3 次导航期间保留的连接。'),
  },
  handler: async (request, response, context) => {
    const result = context.getNetworkModule!().listWebSockets(
      context.getNetworkServices!(),
      request.params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'list_websocket_connections',
    });
  },
});

// ─── listNetworkRequests.ts ──────────────────────────────

export const listNetworkRequests = definePageTool({
  name: 'list_network_requests',
  description:
    '列出当前选中页面自上次导航以来的请求。默认隐藏浏览器扩展请求；支持按资源类型、请求头关键字、分页过滤，以及等待匹配的请求。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的最大请求数。省略时返回全部请求。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('返回的页码（从 0 开始）。省略时返回第一页。'),
    resourceTypes: zod
      .array(zod.enum(FILTERABLE_RESOURCE_TYPES))
      .optional()
      .describe('仅返回指定资源类型的请求。省略或为空时返回全部请求。'),
    includePreservedRequests: zod
      .boolean()
      .default(false)
      .optional()
      .describe('设为 true 可返回最近 3 次导航期间保留的请求。'),
    includeExtensionRequests: zod
      .boolean()
      .default(false)
      .optional()
      .describe('设为 true 可包含 chrome-extension:// 扩展请求。'),
    targetPageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('浏览器页面索引。省略时使用当前活动页面。'),
    targetPageId: zod
      .string()
      .min(1)
      .optional()
      .describe('稳定浏览器页面 ID。可与 targetPageIdx 同时提供以校验一致性。'),
    waitForRequest: zod
      .string()
      .optional()
      .describe('返回前等待 URL 包含该片段的请求出现。'),
    waitTimeoutMs: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('设置 waitForRequest 时，等待匹配请求的最长时间（毫秒）。'),
    headerFilter: zod
      .string()
      .optional()
      .describe('按请求头中包含的关键字过滤请求（大小写不敏感）。'),
    urlFilter: zod
      .string()
      .optional()
      .describe(
        '按 URL 子串过滤请求（大小写不敏感，非正则；例如 "api" 或 "api/login"，Windows Git Bash 下避免以 "/" 开头以防路径改写）。',
      ),
    includeSignatureEvidence: zod
      .boolean()
      .optional()
      .describe('在响应中包含与签名相关的证据关联。'),
  },
  handler: async (request, response, context) => {
    const {pageId, targetPageId} = request.params;
    if (
      pageId &&
      targetPageId &&
      normalizePageId(pageId) !== normalizePageId(targetPageId)
    ) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        `pageId (${pageId}) 与 targetPageId (${targetPageId}) 指向不同页面`,
        {toolName: 'list_network_requests', pageId, targetPageId},
      );
    }
    const result = await context.getNetworkModule!().listRequests(
      context.getNetworkServices!(),
      request.params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'list_network_requests',
    });
  },
});

// ─── mockNetwork.ts ──────────────────────────────────────

export const mockFilterSchema = {
  route: zod
    .string()
    .trim()
    .min(1)
    .refine(
      value => !value.startsWith('/'),
      'route must be an absolute URLPattern, such as https://example.com/app.js or *://*:*/app.js.',
    )
    .superRefine((value, ctx) => {
      try {
        validateUrlPattern(value);
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })
    .optional()
    .describe(
      'Absolute URLPattern, e.g. https://example.com/app.js or `*://*:*/app.js`. Omit to inspect/remove all routes or match any URL.',
    ),
  resourceType: zod
    .enum(FILTERABLE_RESOURCE_TYPES)
    .optional()
    .describe(
      'Restrict requests and stored mock filters to this resource type.',
    ),
};

export const mockNetwork = definePageTool({
  name: 'mock_network',
  description:
    'Inspect or update network mocks for the selected page. With no action params, lists existing mocks. Providing abort, allowOrigin, body (local file), or upstream (replacement URL) creates/updates a mock rule.',
  annotations: {
    title: '网络Mock拦截',
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  blockedByDialog: false,
  concurrency: 'page',
  schema: {
    ...mockFilterSchema,
    abort: zod
      .boolean()
      .optional()
      .describe('Abort matching requests when true.'),
    allowOrigin: zod
      .string()
      .refine(value => {
        if (value === '*' || value === 'null') {
          return true;
        }
        try {
          return new URL(value).origin === value;
        } catch {
          return false;
        }
      }, 'allowOrigin must be *, null, or a serialized origin such as https://example.com.')
      .optional()
      .describe(
        'Set Access-Control-Allow-Origin response header (`*`, `null`, or origin). Requires body or upstream.',
      ),
    body: zod
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Local response body file path (reread per request). Mutually exclusive with upstream.',
      ),
    upstream: zod
      .string()
      .url()
      .optional()
      .describe(
        'Absolute HTTP(S) replacement URL for GET/HEAD requests. Mutually exclusive with body.',
      ),
  },
  handler: async (request, response, context) => {
    const {route, resourceType, abort, allowOrigin, body, upstream} =
      request.params;

    if (body !== undefined && upstream !== undefined) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'body and upstream are mutually exclusive.',
        {toolName: 'mock_network'},
      );
    }

    if (upstream !== undefined && !/^https?:\/\//i.test(upstream)) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'upstream must be an HTTP(S) URL.',
        {toolName: 'mock_network', upstream},
      );
    }

    if (!context.mockNetwork || !context.listNetworkMocks) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        '当前运行时上下文不支持 mock_network。',
        {toolName: 'mock_network'},
      );
    }

    const filter = {
      urlPattern: route,
      resourceType: resourceType as ResourceType | undefined,
    };

    try {
      let overrides;
      let configured = false;
      if (
        abort === undefined &&
        allowOrigin === undefined &&
        body === undefined &&
        upstream === undefined
      ) {
        overrides = context.listNetworkMocks(filter);
      } else {
        let input: NetworkMockInput = {
          ...filter,
          abort,
          allowOrigin,
        };
        if (upstream !== undefined) {
          input = {...input, kind: 'upstream', upstreamUrl: upstream};
        } else if (body !== undefined) {
          const responseFilePath = body;
          input = {
            ...input,
            kind: 'file',
            responseFilePath,
            loadResponseFile: async () => {
              const validated = validateOutputPath(responseFilePath);
              return await fs.readFile(validated);
            },
          };
        }
        overrides = [await context.mockNetwork(input)];
        configured = true;
      }

      const summary = formatNetworkOverrides(overrides);
      if (configured) {
        response.appendResponseLine(
          'Network mock configured. Reload or navigate the page to apply it.',
        );
      }
      response.appendResponseLine(summary);
      response.setStructuredContent({
        success: true,
        message: configured
          ? 'Network mock configured.'
          : overrides.length > 0
            ? `Listed ${overrides.length} network mock(s).`
            : 'No network mocks match these filters.',
        tooltype: 'mock_network',
        data: {
          mocks: overrides,
          summary,
        },
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `mock_network 失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'mock_network'},
      );
    }
  },
});

// ─── removeNetworkMock.ts ────────────────────────────────

export const removeNetworkMock = definePageTool({
  name: 'remove_network_mock',
  description:
    'Remove network mocks matching the supplied stored route and/or resourceType. Omit both filters to remove all mocks for the page.',
  annotations: {
    title: '移除网络Mock',
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  blockedByDialog: false,
  concurrency: 'page',
  schema: mockFilterSchema,
  handler: async (request, response, context) => {
    const {route, resourceType} = request.params;
    if (!context.removeNetworkMocks) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        '当前运行时上下文不支持 remove_network_mock。',
        {toolName: 'remove_network_mock'},
      );
    }

    try {
      const count = await context.removeNetworkMocks({
        urlPattern: route,
        resourceType: resourceType as ResourceType | undefined,
      });
      const message = `Removed ${count} network ${count === 1 ? 'mock' : 'mocks'}.`;
      response.appendResponseLine(message);
      response.setStructuredContent({
        success: true,
        message,
        tooltype: 'remove_network_mock',
        data: {removedCount: count, route, resourceType},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `remove_network_mock 失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'remove_network_mock'},
      );
    }
  },
});

// ─── Re-exports ────────────────────────────────────────────

export * from '../modules/network/NetworkTypes.js';
export {buildEvidenceCorrelations} from '../modules/network/signatureDetector.js';
export {SIGNATURE_HEADER_PATTERN} from '../modules/network/constants.js';

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'network',
  description: 'Network and WebSocket inspection tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './network.js',
      handlerName: 'listNetworkRequests',
    },
    {
      modulePath: './network.js',
      handlerName: 'getNetworkRequest',
    },
    {
      modulePath: './network.js',
      handlerName: 'clearNetworkRequests',
    },
    {
      modulePath: './network.js',
      handlerName: 'listWebSocketConnections',
    },
    {
      modulePath: './network.js',
      handlerName: 'getWebSocketMessages',
    },
    {modulePath: './network.js', handlerName: 'getWebSocketMessage'},
    {
      modulePath: './network.js',
      handlerName: 'analyzeWebSocketMessages',
    },
    {modulePath: './network.js', handlerName: 'mockNetwork'},
    {
      modulePath: './network.js',
      handlerName: 'removeNetworkMock',
    },
  ],
} satisfies DomainManifest;
