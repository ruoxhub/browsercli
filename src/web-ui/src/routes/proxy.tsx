/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Globe, Loader2, Play, Radio, Shield} from 'lucide-react';
import {useEffect, useState} from 'react';

import {CaCertModal} from '../components/proxy/CaCertModal';
import {
  ExportTrafficModal,
  type ExportScope,
} from '../components/proxy/ExportTrafficModal';
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
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportInitialScope, setExportInitialScope] =
    useState<ExportScope>('all');
  const [exportFilteredIds, setExportFilteredIds] = useState<
    string[] | undefined
  >(undefined);
  const [loadingMitm, setLoadingMitm] = useState(false);
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

  // 抓包数据流：持续监听 session.request，并在任一源开启时拉取历史。
  useEffect(() => {
    let mounted = true;

    if (anySourceOn) {
      api
        .getSessionRequests()
        .then(res => {
          if (mounted && res.items) {
            const current = useProxyStore.getState().requests;
            if (current.length === 0) {
              setRequests(res.items);
            } else {
              const historyIds = new Set(res.items.map(r => r.id));
              const newOnly = current.filter(r => !historyIds.has(r.id));
              setRequests([...res.items, ...newOnly]);
            }
          }
        })
        .catch(err => {
          console.error('Failed to get session requests:', err);
        });
    }

    // session.request 是高频频道（每条约触发一次）。单个事件进帧队列，
    // 用 requestAnimationFrame 合并同一帧内的多个推送，再一次性灌入 store
    // 配合 setTimeout 兜底，避免非激活标签页中 requestAnimationFrame 暂停导致积压。
    let frameQueued = false;
    let pending: SessionRequestSummaryEvent[] = [];

    const flush = () => {
      frameQueued = false;
      const batch = pending;
      pending = [];
      if (mounted && batch.length > 0) {
        useProxyStore.getState().addBatch(batch);
      }
    };

    const unsubRequest = wsClient.subscribe('session.request', msg => {
      const payload = msg.payload as SessionRequestSummaryEvent;
      pending.push(payload);
      if (!frameQueued) {
        frameQueued = true;
        if (typeof window !== 'undefined' && !document.hidden) {
          requestAnimationFrame(flush);
          setTimeout(flush, 100);
        } else {
          setTimeout(flush, 50);
        }
      }
    });

    return () => {
      mounted = false;
      frameQueued = false;
      pending = [];
      unsubRequest();
    };
  }, [anySourceOn, setRequests]);

  const handleStartMitm = async () => {
    setLoadingMitm(true);
    try {
      const res = await api.startProxy(8888);
      setStatus({
        running: true,
        port: res.port,
        capturedCount: 0,
        caInitialized: true,
        caCertPath: res.caCertPath,
      });
    } catch (err) {
      console.error('Failed to start proxy:', err);
    } finally {
      setLoadingMitm(false);
    }
  };

  const handleEnableCdp = async () => {
    setCdpEnabled(true);
    try {
      await api.setCaptureSource('cdp', true);
    } catch (err) {
      console.error('Failed to enable CDP:', err);
      setCdpEnabled(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Top Control Bar */}
      <ProxyControlBar
        onOpenCaModal={() => setCaModalOpen(true)}
        onOpenExport={() => {
          setExportInitialScope(
            useProxyStore.getState().selectedIds.length > 0
              ? 'selected'
              : 'all',
          );
          setExportFilteredIds(undefined);
          setExportModalOpen(true);
        }}
      />

      {/* Main Split Pane Content */}
      {anySourceOn ? (
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-[var(--color-border-default)]">
          {/* Left Pane: Request List (40% - 45%) */}
          <div className="w-full md:w-[42%] lg:w-[40%] xl:w-[38%] h-1/2 md:h-full flex flex-col overflow-hidden">
            <ProxyRequestList
              onOpenExport={(scope, visibleIds) => {
                setExportInitialScope(scope);
                setExportFilteredIds(visibleIds);
                setExportModalOpen(true);
              }}
            />
          </div>

          {/* Right Pane: Request Detail (58% - 60%) */}
          <div className="flex-1 h-1/2 md:h-full flex flex-col overflow-hidden">
            <ProxyRequestDetail />
          </div>
        </div>
      ) : (
        <div className="flex-1 h-full flex flex-col items-center justify-center p-6 text-center bg-[var(--color-bg-primary)] overflow-y-auto">
          <div className="max-w-xl w-full flex flex-col items-center">
            {/* 顶层图标与标题 */}
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-[var(--color-bg-tertiary)] to-[var(--color-bg-secondary)] border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-accent)] shadow-xl mb-3.5">
              <Radio
                size={26}
                className="animate-pulse text-[var(--color-accent)]"
              />
            </div>

            <h2 className="text-base font-bold text-[var(--color-text-primary)] mb-1">
              流量抓包未启动
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] max-w-md leading-relaxed mb-6">
              请选择适合当前调试场景的抓包模式，开启后将实时捕获并展示
              HTTP/HTTPS 请求数据
            </p>

            {/* 模式选择卡片 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full text-left mb-5">
              {/* 卡片 1: MITM 代理 */}
              <div className="p-4 rounded-xl bg-[var(--color-bg-secondary)]/80 border border-[var(--color-border-default)] hover:border-emerald-500/40 transition-all flex flex-col justify-between group shadow-sm">
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      MITM 代理
                    </span>
                    <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
                      默认 :8888
                    </span>
                  </div>
                  <h3 className="text-xs font-bold text-[var(--color-text-primary)] mb-1">
                    系统 / 本地代理抓包
                  </h3>
                  <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed mb-4">
                    监听本地端口，支持配合系统代理、桌面客户端拦截指定应用的网络请求并解密
                    HTTPS。
                  </p>
                </div>
                <button
                  onClick={handleStartMitm}
                  disabled={loadingMitm}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 text-xs font-bold transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {loadingMitm ? (
                    <Loader2
                      size={13}
                      className="animate-spin"
                    />
                  ) : (
                    <Play
                      size={13}
                      className="fill-current"
                    />
                  )}
                  <span>启动代理抓包</span>
                </button>
              </div>

              {/* 卡片 2: CDP 浏览器协议 */}
              <div className="p-4 rounded-xl bg-[var(--color-bg-secondary)]/80 border border-[var(--color-border-default)] hover:border-sky-500/40 transition-all flex flex-col justify-between group shadow-sm">
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                      CDP 采集
                    </span>
                    <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
                      免安装证书
                    </span>
                  </div>
                  <h3 className="text-xs font-bold text-[var(--color-text-primary)] mb-1">
                    浏览器协议抓包
                  </h3>
                  <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed mb-4">
                    通过 Chrome DevTools
                    协议直接捕获浏览器活动标签页流量，无侵入、极速、开箱即用。
                  </p>
                </div>
                <button
                  onClick={handleEnableCdp}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-400 text-xs font-bold transition-all shadow-sm cursor-pointer"
                >
                  <Globe size={13} />
                  <span>开启 CDP 采集</span>
                </button>
              </div>
            </div>

            {/* 证书引导帮助 */}
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)]/60 px-3.5 py-2 rounded-lg border border-[var(--color-border-muted)]">
              <Shield
                size={13}
                className="text-amber-400 shrink-0"
              />
              <span>需要解密 HTTPS 流量？请先</span>
              <button
                onClick={() => setCaModalOpen(true)}
                className="text-[var(--color-accent)] hover:underline font-medium cursor-pointer"
              >
                下载与安装 CA 根证书
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CA Certificate Modal */}
      <CaCertModal
        isOpen={caModalOpen}
        onClose={() => setCaModalOpen(false)}
      />

      {/* Traffic Export Modal */}
      <ExportTrafficModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        initialScope={exportInitialScope}
        filteredCount={exportFilteredIds?.length}
        filteredIds={exportFilteredIds}
      />
    </div>
  );
}
