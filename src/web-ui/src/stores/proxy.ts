/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {create} from 'zustand';

import {api} from '../lib/api';
import type {
  SessionRequestSummaryEvent,
  SessionRequestDetail,
  ProxyStatusPayload,
} from '../lib/protocol';

export interface PageInfo {
  pageId: string;
  index: number;
  url: string;
  title: string;
}

export interface ProxyState {
  requests: SessionRequestSummaryEvent[];
  selectedId: string | null;
  selectedDetail: SessionRequestDetail | null;
  detailLoading: boolean;
  status: ProxyStatusPayload | null;
  autoScroll: boolean;
  filter: {
    search: string;
    method: string;
    statusFilter: string;
  };
  setRequests: (requests: SessionRequestSummaryEvent[]) => void;
  addRequest: (req: SessionRequestSummaryEvent) => void;
  clearRequests: () => void;
  selectRequest: (id: string | null) => Promise<void>;
  setStatus: (status: ProxyStatusPayload) => void;
  setAutoScroll: (autoScroll: boolean) => void;
  setFilter: (filter: Partial<ProxyState['filter']>) => void;
  sourceFilter: 'all' | 'cdp' | 'proxy';
  pages: PageInfo[];
  selectedPageId: string | null;
  setSourceFilter: (sourceFilter: 'all' | 'cdp' | 'proxy') => void;
  loadPages: () => Promise<void>;
  selectTab: (pageId: string) => Promise<void>;
}

export const useProxyStore = create<ProxyState>((set, get) => ({
  requests: [],
  selectedId: null,
  selectedDetail: null,
  detailLoading: false,
  status: null,
  autoScroll: true,
  filter: {
    search: '',
    method: '',
    statusFilter: '',
  },
  sourceFilter: 'all',
  pages: [],
  selectedPageId: null,

  setRequests: requests => set({requests}),

  addRequest: req =>
    set(state => {
      const existingIndex = state.requests.findIndex(r => r.id === req.id);
      let newRequests = [...state.requests];

      if (existingIndex > -1) {
        newRequests[existingIndex] = {
          ...newRequests[existingIndex],
          ...req,
        };
      } else {
        newRequests.unshift(req);
      }

      if (newRequests.length > 2000) {
        newRequests = newRequests.slice(0, 2000);
      }

      return {requests: newRequests};
    }),

  clearRequests: () =>
    set({requests: [], selectedId: null, selectedDetail: null}),

  selectRequest: async id => {
    if (id === null) {
      set({selectedId: null, selectedDetail: null, detailLoading: false});
      return;
    }

    set({selectedId: id, detailLoading: true});
    try {
      const detail = await api.getSessionRequestDetail(id);
      if (get().selectedId === id) {
        set({selectedDetail: detail, detailLoading: false});
      }
    } catch {
      if (get().selectedId === id) {
        set({selectedDetail: null, detailLoading: false});
      }
    }
  },

  setStatus: status => set({status}),

  setAutoScroll: autoScroll => set({autoScroll}),

  setFilter: filter =>
    set(state => ({
      filter: {
        ...state.filter,
        ...filter,
      },
    })),

  setSourceFilter: sourceFilter => set({sourceFilter}),

  loadPages: async () => {
    try {
      const res = (await api.callTool('list_pages', {})) as {
        result?: {
          structuredContent?: {
            data?: {
              pageInfos?: PageInfo[];
              selectedPageId?: string | null;
            };
          };
        };
      };
      const data = res?.result?.structuredContent?.data;
      const pageInfos = (data?.pageInfos ?? []) as PageInfo[];
      set({
        pages: pageInfos.map(p => ({
          pageId: p.pageId,
          index: p.index,
          url: p.url,
          title: p.title,
        })),
        selectedPageId: data?.selectedPageId ?? null,
      });
    } catch (err) {
      // 浏览器未连接时 list_pages 会抛；静默降级，不打断页面
      console.error('加载页面列表失败:', err);
    }
  },

  selectTab: async pageId => {
    try {
      // 复用 select_page 工具：bringPageToFront + 切 worker 选中页（spec §7）。
      // 切 tab 不清空（决策 C），也不重拉列表（列表是实时 WS 流，重拉只会
      // 把客户端上限 2000 静默截回 500）；仅重置悬空的选中态。
      await api.callTool('select_page', {pageId});
      set({selectedPageId: pageId, selectedId: null, selectedDetail: null});
    } catch (err) {
      console.error('切换页面失败:', err);
    }
  },
}));
