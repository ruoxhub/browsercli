import type { ApiResponse, WorkerFullStatus, InvocationRecord, SiteExperience } from './protocol';

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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
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
        const errResult = await response.json() as any;
        if (errResult && errResult.error?.message) {
          throw new Error(errResult.error.message);
        }
      } catch (e) {
        if (e instanceof Error && e.message !== `HTTP error! status: ${response.status}`) {
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

  getTools(): Promise<{ tools: ToolSummary[]; total: number }> {
    return request<{ tools: ToolSummary[]; total: number }>('GET', '/api/tools');
  },

  getInvocations(limit?: number): Promise<{ records: InvocationRecord[] }> {
    const query = limit !== undefined ? `?limit=${limit}` : '';
    return request<{ records: InvocationRecord[]; total: number; limit: number }>(
      'GET',
      `/api/invocations${query}`
    ).then(data => ({
      records: data.records,
    }));
  },

  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return request<CallToolResult>(
      'POST',
      `/api/tools/${encodeURIComponent(name)}`,
      { args }
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
  getSiteExperiences(params?: { url?: string; name?: string }): Promise<SiteExperience[]> {
    const searchParams = new URLSearchParams();
    if (params?.url) searchParams.append('url', params.url);
    if (params?.name) searchParams.append('name', params.name);
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<SiteExperience[]>('GET', `/api/site-experiences${query}`);
  },
  getSiteExperienceById(id: number): Promise<SiteExperience> {
    return request<SiteExperience>('GET', `/api/site-experiences/${id}`);
  },
  createSiteExperience(data: Omit<SiteExperience, 'id' | 'createdAt' | 'updatedAt'>): Promise<SiteExperience> {
    return request<SiteExperience>('POST', '/api/site-experiences', data);
  },
  updateSiteExperience(id: number, data: Partial<Omit<SiteExperience, 'id' | 'createdAt' | 'updatedAt'>>): Promise<SiteExperience> {
    return request<SiteExperience>('PUT', `/api/site-experiences/${id}`, data);
  },
  deleteSiteExperience(id: number): Promise<{ success: boolean; id: number }> {
    return request<{ success: boolean; id: number }>('DELETE', `/api/site-experiences/${id}`);
  },
};
