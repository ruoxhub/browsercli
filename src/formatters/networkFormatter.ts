/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Network 请求格式化器（ADR-0010）：
 * 供 DeclarativeResponse.materialize() 与 network 工具共用，
 * 统一产出结构化列表、单条请求明细与可读文本行。
 */

import type {HTTPRequest} from '../third_party/index.js';
import type {PaginationOptions} from '../utils/types.js';

export interface FormattedNetworkItem {
  reqid: number;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
}

export interface FormattedNetworkDetail extends FormattedNetworkItem {
  headers?: Record<string, string>;
  postData?: string;
}

export interface FormattedNetworkList {
  total: number;
  pageIdx: number;
  pageSize: number;
  items: FormattedNetworkItem[];
  lines: string[];
}

function readRequestField<T>(fn: (() => T) | undefined, fallback: T): T {
  try {
    return typeof fn === 'function' ? fn() : fallback;
  } catch {
    return fallback;
  }
}

export function formatNetworkRequestSummary(
  reqid: number,
  request: HTTPRequest,
): {item: FormattedNetworkItem; line: string} {
  const req = request as unknown as {
    method?: () => string;
    url?: () => string;
    resourceType?: () => string;
    response?: () => {status?: () => number} | null;
  };
  const method = readRequestField(req.method?.bind(req), 'GET');
  const url = readRequestField(req.url?.bind(req), '');
  const resourceType = readRequestField(req.resourceType?.bind(req), 'other');
  const resp = readRequestField(req.response?.bind(req), null);
  const status = resp ? readRequestField(resp.status?.bind(resp), undefined) : undefined;

  const item: FormattedNetworkItem = {
    reqid,
    method,
    url,
    resourceType,
    ...(status !== undefined ? {status} : {}),
  };
  const statusText = status !== undefined ? ` [${status}]` : '';
  return {
    item,
    line: `reqid=${reqid} ${method} ${url}${statusText} (${resourceType})`,
  };
}

export function formatNetworkRequestDetail(
  reqid: number,
  request: HTTPRequest,
): {detail: FormattedNetworkDetail; line: string} {
  const {item, line} = formatNetworkRequestSummary(reqid, request);
  const req = request as unknown as {
    headers?: () => Record<string, string>;
    postData?: () => string | undefined;
  };
  const headers = readRequestField(req.headers?.bind(req), undefined);
  const postData = readRequestField(req.postData?.bind(req), undefined);

  return {
    detail: {
      ...item,
      ...(headers ? {headers} : {}),
      ...(postData !== undefined ? {postData} : {}),
    },
    line,
  };
}

export function formatNetworkRequests(
  requests: HTTPRequest[],
  getStableId: (req: HTTPRequest) => number,
  options?: PaginationOptions & {resourceTypes?: string[]},
): FormattedNetworkList {
  const typeFilter = options?.resourceTypes?.length
    ? new Set(options.resourceTypes.map(t => t.toLowerCase()))
    : null;

  const filtered = typeFilter
    ? requests.filter(r => {
        const req = r as unknown as {resourceType?: () => string};
        const rt = readRequestField(req.resourceType?.bind(req), 'other');
        return typeFilter.has(rt.toLowerCase());
      })
    : requests;

  const total = filtered.length;
  const pageSize =
    options?.pageSize && options.pageSize > 0 ? options.pageSize : total || 20;
  const pageIdx = options?.pageIdx && options.pageIdx >= 0 ? options.pageIdx : 0;
  const start = pageIdx * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  const items: FormattedNetworkItem[] = [];
  const lines: string[] = [];
  for (const req of slice) {
    const reqid = getStableId(req);
    const {item, line} = formatNetworkRequestSummary(reqid, req);
    items.push(item);
    lines.push(line);
  }

  return {total, pageIdx, pageSize, items, lines};
}
