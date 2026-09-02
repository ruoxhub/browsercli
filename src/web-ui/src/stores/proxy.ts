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
  /** 批量合并同帧推送，一次 set 落地，避免高频频道每条一次渲染。 */
  addBatch: (reqs: SessionRequestSummaryEvent[]) => void;
  clearRequests: () => void;
  selectRequest: (id: string | null) => Promise<void>;
  setStatus: (status: ProxyStatusPayload) => void;
  setAutoScroll: (autoScroll: boolean) => void;
  setFilter: (filter: Partial<ProxyState['filter']>) => void;
  /** CDP 采集是否开启（后端双源开关，默认关）。 */
  cdpEnabled: boolean;
  pages: PageInfo[];
  selectedPageId: string | null;
  setCdpEnabled: (cdpEnabled: boolean) => void;
  loadPages: () => Promise<void>;
  selectTab: (pageId: string) => Promise<void>;
  selectedIds: string[];
  toggleSelect: (id: string) => void;
  selectAllVisible: (ids: string[]) => void;
  clearSelection: () => void;
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
  cdpEnabled: false,
  pages: [],
  selectedPageId: null,
  selectedIds: [],

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

  addBatch: reqs =>
    set(state => {
      if (reqs.length === 0) return {};
      // 同帧去重：以 id 为键，后到的 update（如 statusCode 落位）覆盖先到的 insert。
      const byId = new Map(state.requests.map(r => [r.id, r]));
      const order: string[] = [];

      for (const req of reqs) {
        if (!byId.has(req.id)) order.push(req.id);
        byId.set(req.id, {...byId.get(req.id), ...req});
      }

      let newRequests = [...order.map(id => byId.get(id)!), ...state.requests];
      if (newRequests.length > 2000) {
        newRequests = newRequests.slice(0, 2000);
      }
      return {requests: newRequests};
    }),

  clearRequests: () =>
    set({
      requests: [],
      selectedId: null,
      selectedDetail: null,
      selectedIds: [],
    }),

  toggleSelect: id =>
    set(state => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter(x => x !== id)
        : [...state.selectedIds, id],
    })),

  selectAllVisible: ids =>
    set(state => {
      const allSelected =
        ids.length > 0 && ids.every(id => state.selectedIds.includes(id));
      return {
        selectedIds: allSelected
          ? state.selectedIds.filter(id => !ids.includes(id))
          : Array.from(new Set([...state.selectedIds, ...ids])),
      };
    }),

  clearSelection: () => set({selectedIds: []}),

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

  setCdpEnabled: cdpEnabled => set({cdpEnabled}),

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
      // detailLoading 必须一起清：否则切 tab 时若有在途的详情请求，
      // selectRequest 的 get().selectedId === id 守卫两边都不成立，
      // 详情面板会永久停在 loading。
      await api.callTool('select_page', {pageId});
      set({
        selectedPageId: pageId,
        selectedId: null,
        selectedDetail: null,
        detailLoading: false,
        selectedIds: [],
      });
      // 切页后重拉一次列表：挂载时的 loadPages 只是快照，新开的标签页
      // 否则永远不会出现在下拉里（loadPages 内部自兜异常，不抛）。
      void get().loadPages();
    } catch (err) {
      console.error('切换页面失败:', err);
    }
  },
}));
