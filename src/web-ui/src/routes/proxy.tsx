/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Globe} from 'lucide-react';
import {useEffect, useState} from 'react';

import {CaCertModal} from '../components/proxy/CaCertModal';
import {ProxyControlBar} from '../components/proxy/ProxyControlBar';
import {ProxyRequestDetail} from '../components/proxy/ProxyRequestDetail';
import {ProxyRequestList} from '../components/proxy/ProxyRequestList';
import {api} from '../lib/api';
import type {
  SessionRequestSummaryEvent,
  ProxyStatusPayload,
} from '../lib/protocol';
import {wsClient} from '../lib/ws';
import {useProxyStore} from '../stores/proxy';

export default function ProxyPage() {
  const [caModalOpen, setCaModalOpen] = useState(false);
  // 细粒度订阅：页面自身只依赖稳定 action 与低频状态。
  const setStatus = useProxyStore(s => s.setStatus);
  const setRequests = useProxyStore(s => s.setRequests);
  const loadPages = useProxyStore(s => s.loadPages);
  const setCdpEnabled = useProxyStore(s => s.setCdpEnabled);
  // 双源开关：MITM 由「启动抓包」按钮控制；CDP 由顶栏 CDP 开关控制（默认关）。
  const running = useProxyStore(s => s.status?.running ?? false);
  const cdpEnabled = useProxyStore(s => s.cdpEnabled);
  // 任一源开启才渲染流量数据；都不开时完全不渲染。
  const anySourceOn = running || cdpEnabled;

  // 一次性：拉取初始状态 + 页面列表 + 双源开关初始值 + 订阅 proxy.status（低频）。
  useEffect(() => {
    let mounted = true;

    api
      .getProxyStatus()
      .then(statusData => {
        if (mounted) {
          setStatus(statusData);
        }
      })
      .catch(err => {
        console.error('Failed to get proxy status:', err);
      });

    void loadPages();

    // CDP 开关初始值由后端返回（GetEnabledSources）。
    api
      .getCaptureSources()
      .then(res => {
        if (mounted) {
          setCdpEnabled((res.sources ?? []).includes('cdp'));
        }
      })
      .catch(() => {
        // 引擎未就绪时 GET 返回 503；保持前端默认（关），开开关时再同步。
      });

    const unsubStatus = wsClient.subscribe('proxy.status', msg => {
      const payload = msg.payload as ProxyStatusPayload;
      setStatus(payload);
    });

    return () => {
      mounted = false;
      unsubStatus();
    };
  }, [setStatus, loadPages, setCdpEnabled]);

  // 抓包数据流：仅任一源开启时才拉取历史 + 订阅 session.request。
  // 未开启时 return 早退，从源头关闭高频数据的渲染。
  useEffect(() => {
    if (!anySourceOn) return;
    let mounted = true;

    api
      .getSessionRequests()
      .then(res => {
        if (mounted && res.items) {
          setRequests(res.items);
        }
      })
      .catch(err => {
        console.error('Failed to get session requests:', err);
      });

    // session.request 是高频频道（每条约触发一次）。单个事件进帧队列，
    // 用 requestAnimationFrame 合并同一帧内的多个推送，再一次性灌入 store
    // —— 否则流量高峰时每个请求都会引发一次 React 渲染。
    let frameQueued = false;
    let pending: SessionRequestSummaryEvent[] = [];

    const flush = () => {
      frameQueued = false;
      const batch = pending;
      pending = [];
      if (mounted) {
        useProxyStore.getState().addBatch(batch);
      }
    };

    const unsubRequest = wsClient.subscribe('session.request', msg => {
      const payload = msg.payload as SessionRequestSummaryEvent;
      pending.push(payload);
      if (!frameQueued) {
        frameQueued = true;
        requestAnimationFrame(flush);
      }
    });

    return () => {
      mounted = false;
      frameQueued = false;
      pending = [];
      unsubRequest();
    };
  }, [anySourceOn, setRequests]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Top Control Bar */}
      <ProxyControlBar onOpenCaModal={() => setCaModalOpen(true)} />

      {/* Main Split Pane Content */}
      {anySourceOn ? (
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-[var(--color-border-default)]">
          {/* Left Pane: Request List (40% - 45%) */}
          <div className="w-full md:w-[42%] lg:w-[40%] xl:w-[38%] h-1/2 md:h-full flex flex-col overflow-hidden">
            <ProxyRequestList />
          </div>

          {/* Right Pane: Request Detail (58% - 60%) */}
          <div className="flex-1 h-1/2 md:h-full flex flex-col overflow-hidden">
            <ProxyRequestDetail />
          </div>
        </div>
      ) : (
        <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center bg-[var(--color-bg-primary)]">
          <div className="w-12 h-12 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-muted)] mb-3">
            <Globe size={22} />
          </div>
          <p className="text-xs font-semibold text-[var(--color-text-primary)]">
            未启动抓包
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] max-w-sm leading-relaxed mt-1">
            点击上方「启动抓包」开启 MITM
            采集，或打开「CDP」开关采集浏览器流量；
            任一源开启后才会拉取并渲染捕获数据。
          </p>
        </div>
      )}

      {/* CA Certificate Modal */}
      <CaCertModal
        isOpen={caModalOpen}
        onClose={() => setCaModalOpen(false)}
      />
    </div>
  );
}
