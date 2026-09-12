/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ApiResponse,
  ExportedConfig,
  LogContent,
  RuntimeConfig,
  SystemInfo,
  WorkerFullStatus,
  InvocationRecord,
  BrowserConfig,
  ConnectResult,
  LocalAppsStatus,
  ProcessInfo,
  ProxyStatusPayload,
  ListMitmRequestsData,
  GetMitmRequestData,
  SessionRequestSummaryEvent,
  SessionRequestDetail,
} from './protocol';

export interface ToolSummary {
  name: string;
  description: string;
  category?: string;
  profile?: string;
  argSpecs?: Record<string, unknown>;
  jsonSchema?: unknown;
  inputSchema?: any;
}

export interface CallToolResult {
  invocationId: string;
  traceId: string;
  result: unknown;
  durationMs: number;
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const errResult = (await response.json()) as any;
        if (errResult && errResult.error?.message) {
          throw new Error(errResult.error.message);
        }
      } catch (e) {
        if (
          e instanceof Error &&
          e.message !== `HTTP error! status: ${response.status}`
        ) {
          throw e;
        }
      }
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result: ApiResponse<T> = await response.json();
  if (!result.success) {
    throw new Error(result.error?.message || 'API request failed');
  }

  if (result.data === undefined) {
    throw new Error('API request returned empty data');
  }

  return result.data;
}

export const api = {
  getWorkerStatus(): Promise<WorkerFullStatus> {
    return request<WorkerFullStatus>('GET', '/api/worker/status');
  },

  getTools(): Promise<{tools: ToolSummary[]; total: number}> {
    return request<{tools: ToolSummary[]; total: number}>('GET', '/api/tools');
  },

  getInvocations(limit?: number): Promise<{records: InvocationRecord[]}> {
    const query = limit !== undefined ? `?limit=${limit}` : '';
    return request<{records: InvocationRecord[]; total: number; limit: number}>(
      'GET',
      `/api/invocations${query}`,
    ).then(data => ({
      records: data.records,
    }));
  },

  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    return request<CallToolResult>(
      'POST',
      `/api/tools/${encodeURIComponent(name)}`,
      {args},
    );
  },
  getHooks(): Promise<any> {
    return request<any>('GET', '/api/hooks');
  },
  createHook(args: Record<string, unknown>): Promise<any> {
    return request<any>('POST', '/api/hooks', args);
  },
  deleteHook(hookId: string): Promise<any> {
    return request<any>('DELETE', `/api/hooks/${encodeURIComponent(hookId)}`);
  },

  getConfig(): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('GET', '/api/config');
  },

  updateBrowserConfig(config: Partial<BrowserConfig>): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('PUT', '/api/config/browser', config);
  },

  getSystemInfo(): Promise<SystemInfo> {
    return request<SystemInfo>('GET', '/api/system/info');
  },

  getSystemLog(file?: string): Promise<LogContent> {
    const query = file ? `?file=${encodeURIComponent(file)}` : '';
    return request<LogContent>('GET', `/api/system/logs${query}`);
  },

  exportConfig(): Promise<ExportedConfig> {
    return request<ExportedConfig>('GET', '/api/config/export');
  },

  importConfig(config: ExportedConfig): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('POST', '/api/config/import', config);
  },

  resetConfig(): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('POST', '/api/config/reset', {});
  },

  connectBrowser(): Promise<ConnectResult> {
    return request<ConnectResult>('POST', '/api/browser/connect');
  },

  disconnectBrowser(): Promise<ConnectResult> {
    return request<ConnectResult>('POST', '/api/browser/disconnect');
  },

  getProxyStatus(): Promise<ProxyStatusPayload> {
    return request<ProxyStatusPayload>('GET', '/api/proxy/status');
  },

  startProxy(port?: number): Promise<{port: number; caCertPath: string}> {
    return request<{port: number; caCertPath: string}>(
      'POST',
      '/api/proxy/start',
      {port},
    );
  },

  stopProxy(): Promise<ProxyStatusPayload> {
    return request<ProxyStatusPayload>('POST', '/api/proxy/stop');
  },

  getProxyRequests(params?: {
    urlFilter?: string;
    pageIdx?: number;
    pageSize?: number;
  }): Promise<ListMitmRequestsData> {
    const query = new URLSearchParams();
    if (params?.urlFilter) query.set('urlFilter', params.urlFilter);
    if (params?.pageIdx !== undefined)
      query.set('pageIdx', String(params.pageIdx));
    if (params?.pageSize !== undefined)
      query.set('pageSize', String(params.pageSize));
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<ListMitmRequestsData>('GET', `/api/proxy/requests${qs}`);
  },

  getProxyRequestDetail(id: number): Promise<GetMitmRequestData> {
    return request<GetMitmRequestData>('GET', `/api/proxy/requests/${id}`);
  },

  clearProxyRequests(): Promise<{clearedCount: number}> {
    return request<{clearedCount: number}>('DELETE', '/api/proxy/requests');
  },

  getProxyLocalIps(): Promise<{ips: string[]}> {
    return request<{ips: string[]}>('GET', '/api/proxy/ips');
  },

  getLocalApps(): Promise<LocalAppsStatus> {
    return request<LocalAppsStatus>('GET', '/api/proxy/local-apps');
  },

  configureLocalApps(body: {
    enabled?: boolean;
    targets?: string[];
  }): Promise<LocalAppsStatus> {
    return request<LocalAppsStatus>('POST', '/api/proxy/local-apps', body);
  },

  listLocalProcesses(): Promise<{processes: ProcessInfo[]}> {
    return request<{processes: ProcessInfo[]}>('GET', '/api/proxy/processes');
  },

  getSessionRequests(params?: {
    sources?: string;
    urlFilter?: string;
    filter?: string;
    limit?: number;
    offset?: number;
  }): Promise<{items: SessionRequestSummaryEvent[]; total: number}> {
    const query = new URLSearchParams();
    if (params?.sources) query.set('sources', params.sources);
    if (params?.urlFilter) query.set('urlFilter', params.urlFilter);
    if (params?.filter) query.set('filter', params.filter);
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.offset !== undefined)
      query.set('offset', String(params.offset));
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<{items: SessionRequestSummaryEvent[]; total: number}>(
      'GET',
      `/api/session/requests${qs}`,
    );
  },

  getSessionRequestDetail(id: string): Promise<SessionRequestDetail> {
    return request<SessionRequestDetail>(
      'GET',
      `/api/session/requests/${encodeURIComponent(id)}`,
    );
  },

  clearSessionRequests(): Promise<{clearedCount: number}> {
    return request<{clearedCount: number}>('DELETE', '/api/session/requests');
  },

  getCaptureSources(): Promise<{sources: string[]}> {
    return request<{sources: string[]}>('GET', '/api/session/capture-sources');
  },

  setCaptureSource(
    source: 'cdp' | 'proxy',
    enabled: boolean,
  ): Promise<{sources: string[]}> {
    return request<{sources: string[]}>(
      'POST',
      '/api/session/capture-sources',
      {source, enabled},
    );
  },
};
