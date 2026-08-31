/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Globe, Inbox} from 'lucide-react';
import React, {useEffect, useMemo, useRef} from 'react';

import type {SessionRequestSummaryEvent} from '../../lib/protocol';
import {useProxyStore} from '../../stores/proxy';

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

export const ProxyRequestList: React.FC<ProxyRequestListProps> = ({
  onSelect,
}) => {
  const {
    requests,
    selectedId,
    autoScroll,
    filter,
    sourceFilter,
    selectedIds,
    selectRequest,
    toggleSelect,
    selectAllVisible,
    clearSelection,
  } = useProxyStore();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);

  // Filter requests based on source, method and search text
  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      if (sourceFilter !== 'all' && req.source !== sourceFilter) {
        return false;
      }
      if (
        filter.method &&
        req.method.toUpperCase() !== filter.method.toUpperCase()
      ) {
        return false;
      }
      if (filter.search) {
        const query = filter.search.toLowerCase();
        const matchesUrl = req.url.toLowerCase().includes(query);
        const matchesMethod = req.method.toLowerCase().includes(query);
        const matchesStatus = String(req.statusCode).includes(query);
        if (!matchesUrl && !matchesMethod && !matchesStatus) {
          return false;
        }
      }
      return true;
    });
  }, [requests, filter, sourceFilter]);

  // Handle auto-scroll to top/new requests
  useEffect(() => {
    if (autoScroll && listContainerRef.current) {
      listContainerRef.current.scrollTop = 0;
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
          void selectRequest(nextReq.id);
          onSelect?.(nextReq.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredRequests, selectedId, selectRequest, onSelect]);

  const handleItemClick = (req: SessionRequestSummaryEvent) => {
    void selectRequest(req.id);
    onSelect?.(req.id);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--color-bg-primary)]/50">
      {/* 多选工具条：全选当前过滤结果 / 清空选择 */}
      <div className="shrink-0 flex items-center gap-2 px-3.5 py-1.5 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-secondary)]/40 text-[11px]">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={
              filteredRequests.length > 0 &&
              filteredRequests.every(r => selectedIds.includes(r.id))
            }
            onChange={() => selectAllVisible(filteredRequests.map(r => r.id))}
            disabled={filteredRequests.length === 0}
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
        {filteredRequests.length === 0 ? (
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
          filteredRequests.map(req => {
            const isSelected = selectedId === req.id;
            const isChecked = selectedIds.includes(req.id);
            const timeStr = new Date(req.timestamp).toLocaleTimeString();
            const contentTypeTag = simplifyContentType(req.contentType);

            return (
              <div
                key={req.id}
                ref={isSelected ? activeItemRef : null}
                onClick={() => handleItemClick(req)}
                className={`group flex items-center justify-between px-3.5 py-2.5 cursor-pointer text-xs transition-all duration-150 border-l-2 ${
                  isSelected
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
                      checked={isChecked}
                      onChange={() => toggleSelect(req.id)}
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
          })
        )}
      </div>
    </div>
  );
};
