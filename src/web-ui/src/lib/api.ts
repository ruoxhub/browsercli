/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ApiResponse,
  WorkerFullStatus,
  InvocationRecord,
  RuntimeConfig,
  BrowserConfig,
  ConnectResult,
  LlmTestResult,
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

  updateLlmConfig(config: {
    llmProvider?: string;
    openai?: Record<string, unknown>;
  }): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('PUT', '/api/config/llm', config);
  },

  testLlmConfig(config: {
    llmProvider?: string;
    openai?: Record<string, unknown>;
  }): Promise<LlmTestResult> {
    return request<LlmTestResult>('POST', '/api/llm/test', config);
  },

  listLlmModels(config?: {
    llmProvider?: string;
    openai?: Record<string, unknown>;
  }): Promise<{models: {id: string; object?: string; owned_by?: string}[]}> {
    return request<{
      models: {id: string; object?: string; owned_by?: string}[];
    }>('POST', '/api/llm/models', config ?? {});
  },

  connectBrowser(): Promise<ConnectResult> {
    return request<ConnectResult>('POST', '/api/browser/connect');
  },

  disconnectBrowser(): Promise<ConnectResult> {
    return request<ConnectResult>('POST', '/api/browser/disconnect');
  },
};
