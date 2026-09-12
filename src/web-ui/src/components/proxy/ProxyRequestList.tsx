/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Globe, Inbox} from 'lucide-react';
import React, {memo, useEffect, useMemo, useRef, useState} from 'react';

import type {
  SessionRequestDetail,
  SessionRequestSummaryEvent,
} from '../../lib/protocol';
import {api} from '../../lib/api';
import {compileFlowFilter} from '../../lib/flowFilter';
import {useProxyStore} from '../../stores/proxy';
import {parseClientProcess} from './clientProcess';

interface ProxyRequestListProps {
  onSelect?: (id: string) => void;
}

function getMethodBadgeClass(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'POST':
      return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    case 'PUT':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'DELETE':
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    case 'OPTIONS':
      return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
    case 'PATCH':
      return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30';
    default:
      return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
  }
}

function getStatusBadgeClass(status: number): string {
  if (status >= 200 && status < 300) {
    return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  }
  if (status >= 300 && status < 400) {
    return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  }
  if (status >= 400) {
    return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
  }
  return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
}

function simplifyContentType(ct: string | null): string {
  if (!ct) return '-';
  if (ct.includes('application/json')) return 'JSON';
  if (ct.includes('text/html')) return 'HTML';
  if (ct.includes('javascript') || ct.includes('ecmascript')) return 'JS';
  if (ct.includes('text/css')) return 'CSS';
  if (ct.includes('image/')) return 'IMG';
  if (ct.includes('application/octet-stream')) return 'BIN';
  if (ct.includes('text/event-stream')) return 'SSE';
  return ct.split(';')[0].split('/').pop()?.toUpperCase() || '-';
}

function sourceBadgeClass(source: string): string {
  return source === 'proxy'
    ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
    : 'bg-sky-500/15 text-sky-400 border-sky-500/30';
}

interface RequestRowProps {
  req: SessionRequestSummaryEvent;
  selected: boolean;
  checked: boolean;
  timeStr: string;
  contentTypeTag: string;
  onSelectRow: (id: string) => void;
  onToggle: (id: string) => void;
}

/**
 * 单行 memo 化：请求对象在 store 里按 id 保持引用稳定（addBatch 只替换
 * 变更项），列表中未变化的行在本组件后续渲染中直接跳过 DOM 重建，只对
 * 新增/更新的行做 diff。
 */
const RequestRow = memo(function RequestRow({
  req,
  selected,
  checked,
  timeStr,
  contentTypeTag,
  onSelectRow,
  onToggle,
}: RequestRowProps) {
  return (
    <div
      onClick={() => onSelectRow(req.id)}
      className={`group flex items-center justify-between px-3.5 py-2.5 cursor-pointer text-xs transition-all duration-150 border-l-2 ${
        selected
          ? 'bg-[var(--color-accent)]/10 border-l-[var(--color-accent)] text-[var(--color-text-primary)] shadow-inner'
          : 'border-l-transparent hover:bg-[var(--color-bg-secondary)]/80 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {/* Left summary items */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-3">
        {/* Multi-select checkbox */}
        <span
          onClick={e => e.stopPropagation()}
          className="shrink-0 flex items-center"
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(req.id)}
            className="w-3.5 h-3.5 rounded border border-[var(--color-border-default)] accent-[var(--color-accent)] cursor-pointer"
            title="勾选后参与 AI 分析"
          />
        </span>

        {/* Source badge */}
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border uppercase shrink-0 ${sourceBadgeClass(
            req.source,
          )}`}
        >
          {req.source === 'proxy' ? 'Proxy' : 'CDP'}
        </span>

        {/* Method badge */}
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border uppercase shrink-0 ${getMethodBadgeClass(
            req.method,
          )}`}
        >
          {req.method}
        </span>

        {/* Status code badge */}
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${getStatusBadgeClass(
            req.statusCode,
          )}`}
        >
          {req.statusCode || '-'}
        </span>

        {/* Client Process badge */}
        {(() => {
          const cp = parseClientProcess(req.initiator);
          return cp ? (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-mono border shrink-0 bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border-default)]"
              title={`pid: ${cp.pid}`}
            >
              💬 {cp.name}
            </span>
          ) : null;
        })()}

        {/* URL Display */}
        <div className="min-w-0 flex-1">
          <p
            className="truncate font-mono text-[11px] text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors"
            title={req.url}
          >
            {req.url}
          </p>
        </div>
      </div>

      {/* Right metadata items */}
      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
        {/* Content-Type Tag */}
        <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[9px] font-medium">
          {contentTypeTag}
        </span>

        {/* Timestamp */}
        <span>{timeStr}</span>
      </div>
    </div>
  );
});

function shouldIncludeRequest(
  req: SessionRequestSummaryEvent,
  filterFn: ((flow: SessionRequestSummaryEvent) => boolean) | null,
  serverFilteredIds: Set<string> | null,
  detailsCache: Record<string, SessionRequestDetail>,
  selectedId: string | null,
  selectedDetail: SessionRequestDetail | null,
): boolean {
  if (!filterFn) return true;

  if (serverFilteredIds !== null) {
    if (serverFilteredIds.has(req.id)) return true;
    const detail =
      detailsCache[req.id] || (selectedId === req.id ? selectedDetail : null);
    return Boolean(detail && filterFn({...req, ...detail}));
  }

  const detail =
    detailsCache[req.id] || (selectedId === req.id ? selectedDetail : null);
  const flow = detail ? {...req, ...detail} : req;
  return filterFn(flow);
}

export const ProxyRequestList: React.FC<ProxyRequestListProps> = ({
  onSelect,
}) => {
  // 字段级订阅：任何单一字段变化都只触发本组件渲染，而非无选择器订阅时的
  // 「任何一次 requests/status/filter 喷发都全量重渲染」。
  const requests = useProxyStore(s => s.requests);
  const selectedId = useProxyStore(s => s.selectedId);
  const selectedDetail = useProxyStore(s => s.selectedDetail);
  const detailsCache = useProxyStore(s => s.detailsCache);
  const addBatch = useProxyStore(s => s.addBatch);
  const autoScroll = useProxyStore(s => s.autoScroll);
  const filter = useProxyStore(s => s.filter);
  // 双源开关：展示哪些 source 由后端开关决定（CDP 开关 + MITM 运行态）。
  const cdpEnabled = useProxyStore(s => s.cdpEnabled);
  const mitmRunning = useProxyStore(s => s.status?.running ?? false);
  const selectedIds = useProxyStore(s => s.selectedIds);
  const selectRequest = useProxyStore(s => s.selectRequest);
  const toggleSelect = useProxyStore(s => s.toggleSelect);
  const selectAllVisible = useProxyStore(s => s.selectAllVisible);
  const clearSelection = useProxyStore(s => s.clearSelection);

  const [serverFilteredIds, setServerFilteredIds] =
    useState<Set<string> | null>(null);

  const listContainerRef = useRef<HTMLDivElement>(null);

  // 当搜索关键词变化时，防抖向服务端发起深度过滤检索（确保 ~b/~bs/~h 等深层字段能全库命中）
  useEffect(() => {
    const query = filter.search.trim();
    if (!query) {
      setServerFilteredIds(null);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const sources: string[] = [];
        if (cdpEnabled) sources.push('cdp');
        if (mitmRunning) sources.push('proxy');
        const res = await api.getSessionRequests({
          filter: query,
          sources: sources.length > 0 ? sources.join(',') : undefined,
          limit: 1000,
        });
        if (active && res?.items) {
          // 若有尚未灌入本地 store 的历史匹配项，补充合并
          const currentStore = useProxyStore.getState().requests;
          const currentIds = new Set(currentStore.map(r => r.id));
          const missing = res.items.filter(r => !currentIds.has(r.id));
          if (missing.length > 0) {
            addBatch(missing);
          }
          setServerFilteredIds(new Set(res.items.map(r => r.id)));
        }
      } catch (err) {
        console.error('流过滤服务端搜索失败:', err);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [filter.search, cdpEnabled, mitmRunning, addBatch]);

  // Filter requests based on enabled sources, method and search text
  const filteredRequests = useMemo(() => {
    const filterFn = filter.search
      ? compileFlowFilter(filter.search, {fallbackFuzzy: true})
      : null;

    return requests.filter(req => {
      // 双源开关：未被开启的 source 不展示（源自后端开关，非临时显示过滤）。
      if (req.source === 'cdp' && !cdpEnabled) return false;
      if (req.source === 'proxy' && !mitmRunning) return false;
      if (
        filter.method &&
        req.method.toUpperCase() !== filter.method.toUpperCase()
      ) {
        return false;
      }
      return shouldIncludeRequest(
        req,
        filterFn,
        serverFilteredIds,
        detailsCache,
        selectedId,
        selectedDetail,
      );
    });
  }, [
    requests,
    filter,
    cdpEnabled,
    mitmRunning,
    serverFilteredIds,
    detailsCache,
    selectedId,
    selectedDetail,
  ]);

  // 预计算每行展示的派生字符串：Date 格式化与 content-type 归一化搬到
  // 渲染前一次完成，行组件拿到的都是标量，render 阶段零额外计算。
  const rows = useMemo(
    () =>
      filteredRequests.map(req => ({
        req,
        timeStr: new Date(req.timestamp).toLocaleTimeString(),
        contentTypeTag: simplifyContentType(req.contentType),
      })),
    [filteredRequests],
  );

  const visibleIdsCount = filteredRequests.length;

  const handleSelectRow = (id: string) => {
    void selectRequest(id);
    onSelect?.(id);
  };

  // Handle auto-scroll to latest requests at bottom
  useEffect(() => {
    if (autoScroll && listContainerRef.current) {
      listContainerRef.current.scrollTop =
        listContainerRef.current.scrollHeight;
    }
  }, [requests.length, autoScroll]);

  // Keyboard navigation (ArrowUp / ArrowDown)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredRequests.length === 0) return;

        const currentIndex = filteredRequests.findIndex(
          r => r.id === selectedId,
        );
        let nextIndex = 0;

        if (e.key === 'ArrowDown') {
          nextIndex =
            currentIndex < filteredRequests.length - 1 ? currentIndex + 1 : 0;
        } else if (e.key === 'ArrowUp') {
          nextIndex =
            currentIndex > 0 ? currentIndex - 1 : filteredRequests.length - 1;
        }

        const nextReq = filteredRequests[nextIndex];
        if (nextReq) {
          handleSelectRow(nextReq.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredRequests, selectedId, selectRequest, onSelect]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--color-bg-primary)]/50">
      {/* 多选工具条：全选当前过滤结果 / 清空选择 */}
      <div className="shrink-0 flex items-center gap-2 px-3.5 py-1.5 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-secondary)]/40 text-[11px]">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={
              visibleIdsCount > 0 &&
              filteredRequests.every(r => selectedIds.includes(r.id))
            }
            onChange={() => selectAllVisible(filteredRequests.map(r => r.id))}
            disabled={visibleIdsCount === 0}
            className="w-3.5 h-3.5 rounded border border-[var(--color-border-default)] accent-[var(--color-accent)] cursor-pointer disabled:opacity-40"
          />
          <span className="text-[var(--color-text-muted)]">全选</span>
        </label>
        {selectedIds.length > 0 && (
          <>
            <span className="text-[var(--color-accent)] font-mono">
              已选 {selectedIds.length} 条
            </span>
            <button
              onClick={clearSelection}
              className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              清空选择
            </button>
          </>
        )}
      </div>

      <div
        ref={listContainerRef}
        tabIndex={0}
        className="flex-1 flex flex-col min-h-0 overflow-y-auto outline-none select-none divide-y divide-[var(--color-border-muted)]"
      >
        {visibleIdsCount === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-muted)]">
              {requests.length === 0 ? (
                <Globe
                  size={22}
                  className="animate-pulse"
                />
              ) : (
                <Inbox size={22} />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[var(--color-text-primary)]">
                {requests.length === 0 ? '等待流量捕获...' : '没有匹配的请求'}
              </p>
              <p className="text-[11px] text-[var(--color-text-muted)] max-w-[240px] leading-relaxed">
                {requests.length === 0
                  ? '当浏览网页产生流量时，请求会自动显示在此列表（CDP + 代理）。'
                  : '请调整上方 Method 过滤或搜索关键词。'}
              </p>
            </div>
          </div>
        ) : (
          rows.map(({req, timeStr, contentTypeTag}) => (
            <RequestRow
              key={req.id}
              req={req}
              selected={selectedId === req.id}
              checked={selectedIds.includes(req.id)}
              timeStr={timeStr}
              contentTypeTag={contentTypeTag}
              onSelectRow={handleSelectRow}
              onToggle={toggleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
};
