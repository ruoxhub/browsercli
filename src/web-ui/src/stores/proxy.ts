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
}));
