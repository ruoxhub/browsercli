/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ArrowDown,
  ChevronDown,
  Filter,
  Globe,
  Loader2,
  Play,
  Search,
  Shield,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import React, {useEffect, useMemo, useRef, useState} from 'react';

import {api} from '../../lib/api';
import {FLOW_FILTER_HELP, type FlowFilterHelpItem} from '../../lib/flowFilter';
import {useProxyStore} from '../../stores/proxy';
import {LocalAppsControl} from './LocalAppsControl';

interface ProxyControlBarProps {
  onOpenCaModal: () => void;
}

const METHODS = [
  'ALL',
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'OPTIONS',
  'PATCH',
  'HEAD',
];

export const ProxyControlBar: React.FC<ProxyControlBarProps> = ({
  onOpenCaModal,
}) => {
  const status = useProxyStore(s => s.status);
  const autoScroll = useProxyStore(s => s.autoScroll);
  const filter = useProxyStore(s => s.filter);
  const cdpEnabled = useProxyStore(s => s.cdpEnabled);
  const pages = useProxyStore(s => s.pages);
  const selectedPageId = useProxyStore(s => s.selectedPageId);
  const selectedIds = useProxyStore(s => s.selectedIds);
  const totalRequests = useProxyStore(s => s.requests.length);
  const setStatus = useProxyStore(s => s.setStatus);
  const setAutoScroll = useProxyStore(s => s.setAutoScroll);
  const setFilter = useProxyStore(s => s.setFilter);
  const setCdpEnabled = useProxyStore(s => s.setCdpEnabled);
  const selectTab = useProxyStore(s => s.selectTab);
  const clearRequests = useProxyStore(s => s.clearRequests);

  const [inputPort, setInputPort] = useState<number>(status?.port ?? 8888);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showFilterHelp, setShowFilterHelp] = useState(false);
  // 用户主动关闭（Escape / 点击外部）后置 true，只有重新输入 `~` 才再次弹出，
  // 避免在已含 `~` 的表达式上任意输入都让面板复活。
  const filterHelpDismissedRef = useRef(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        filterHelpDismissedRef.current = true;
        setShowFilterHelp(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchChange = (val: string) => {
    setFilter({search: val});
    // 仅在「刚输入 ~」时重置关闭标记，之后继续输入不会重开面板。
    if (val.endsWith('~')) filterHelpDismissedRef.current = false;
    if (val.includes('~') && !filterHelpDismissedRef.current) {
      setShowFilterHelp(true);
    }
  };

  const insertFilterSuggestion = (item: FlowFilterHelpItem) => {
    const current = filter.search;
    // 以最后一个 token 边界为准替换正在输入的 ~token，避免固定偏移量在
    // 较长操作符（~websocket 等）上失效。
    const boundary = Math.max(
      current.lastIndexOf(' '),
      current.lastIndexOf('('),
      current.lastIndexOf('|'),
      current.lastIndexOf('!'),
    );
    const tail = current.slice(boundary + 1);
    const base = tail.startsWith('~')
      ? current.slice(0, boundary + 1)
      : current;
    const spacer = base.length > 0 && !base.endsWith(' ') ? ' ' : '';
    const toInsert = `${item.code} `;
    filterHelpDismissedRef.current = true;
    setFilter({search: `${base}${spacer}${toInsert}`});
    setShowFilterHelp(false);
  };

  const filteredSuggestions = useMemo(() => {
    const lastTildeIdx = filter.search.lastIndexOf('~');
    if (lastTildeIdx === -1) return FLOW_FILTER_HELP;
    const partial = filter.search.slice(lastTildeIdx).trim().toLowerCase();
    if (!partial || partial === '~') return FLOW_FILTER_HELP;
    return FLOW_FILTER_HELP.filter(
      item =>
        item.code.toLowerCase().startsWith(partial) ||
        item.name.toLowerCase().includes(partial.slice(1)) ||
        item.description.toLowerCase().includes(partial.slice(1)),
    );
  }, [filter.search]);

  const isRunning = status?.running ?? false;

  const handleToggleProxy = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      if (isRunning) {
        const res = await api.stopProxy();
        setStatus(res);
      } else {
        const res = await api.startProxy(inputPort);
        setStatus({
          running: true,
          port: res.port,
          capturedCount: status?.capturedCount ?? 0,
          caInitialized: true,
          caCertPath: res.caCertPath,
        });
      }
    } catch (err) {
      console.error('Failed to toggle proxy:', err);
      setErrorMsg(err instanceof Error ? err.message : '切换代理状态失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    try {
      await api.clearSessionRequests();
      clearRequests();
    } catch (err) {
      console.error('Failed to clear session requests:', err);
    }
  };

  const handleToggleCdp = async () => {
    const target = !cdpEnabled;
    // 乐观更新，失败回滚。
    setCdpEnabled(target);
    try {
      await api.setCaptureSource('cdp', target);
    } catch (err) {
      console.error('Failed to toggle CDP capture:', err);
      setCdpEnabled(!target);
    }
  };

  return (
    <div className="flex flex-col border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/90 backdrop-blur-md">
      {/* 顶栏主操作区 */}
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        {/* 左侧：抓包源与目标配置 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 启动 / 停止代理按钮 */}
          <button
            onClick={handleToggleProxy}
            disabled={loading}
            className={`h-8 flex items-center gap-2 px-3.5 rounded-lg text-xs font-bold transition-all shadow-sm shrink-0 whitespace-nowrap ${
              isRunning
                ? 'bg-rose-500/15 border border-rose-500/35 text-rose-400 hover:bg-rose-500/25'
                : 'bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 hover:bg-emerald-500/25 hover:border-emerald-500/50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading ? (
              <Loader2
                size={13}
                className="animate-spin"
              />
            ) : isRunning ? (
              <Square
                size={13}
                className="fill-current"
              />
            ) : (
              <Play
                size={13}
                className="fill-current"
              />
            )}
            <span>{isRunning ? '停止代理' : '启动抓包'}</span>
          </button>

          {/* 端口配置 */}
          <div className="h-8 flex items-center gap-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] px-2.5 rounded-lg text-xs shrink-0 whitespace-nowrap">
            <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
              端口:
            </span>
            <input
              type="number"
              min={1}
              max={65535}
              value={isRunning ? (status?.port ?? inputPort) : inputPort}
              onChange={e =>
                setInputPort(Number.parseInt(e.target.value, 10) || 8888)
              }
              disabled={isRunning || loading}
              className="w-14 bg-transparent text-xs font-mono text-[var(--color-text-primary)] focus:outline-none disabled:text-[var(--color-text-muted)]"
            />
          </div>

          {/* 本地应用拦截控制 */}
          <LocalAppsControl />

          {/* 分隔线 */}
          <div className="h-4 w-px bg-[var(--color-border-default)] shrink-0 mx-0.5" />

          {/* CDP 采集开关 */}
          <button
            onClick={handleToggleCdp}
            className={`h-8 flex items-center gap-2 px-3 rounded-lg text-xs font-bold transition-all shrink-0 whitespace-nowrap ${
              cdpEnabled
                ? 'bg-sky-500/15 border border-sky-500/35 text-sky-400 hover:bg-sky-500/25'
                : 'bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-sky-500/30 hover:text-sky-400'
            }`}
            title="采集自动化浏览器（CDP）协议流量"
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                cdpEnabled
                  ? 'bg-sky-400 animate-pulse'
                  : 'bg-[var(--color-text-muted)]'
              }`}
            />
            <span>CDP 采集</span>
          </button>

          {/* 目标标签页下拉 */}
          <div
            className="h-8 flex items-center gap-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] px-2.5 rounded-lg text-xs shrink-0 whitespace-nowrap max-w-[220px]"
            title={
              pages.find(p => p.pageId === selectedPageId)?.title ||
              '选择监控页面'
            }
          >
            <Globe
              size={13}
              className="text-[var(--color-text-muted)] shrink-0"
            />
            <select
              value={selectedPageId ?? ''}
              onChange={e => {
                const id = e.target.value;
                if (id) void selectTab(id);
              }}
              className="bg-transparent text-xs font-mono text-[var(--color-text-primary)] focus:outline-none truncate max-w-[170px] cursor-pointer"
            >
              <option
                value=""
                disabled
              >
                选择页面…
              </option>
              {pages.map(p => (
                <option
                  key={p.pageId}
                  value={p.pageId}
                  className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
                >
                  {`#${p.index} ${p.title}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 右侧：快捷工具 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* CA 证书 */}
          <button
            onClick={onOpenCaModal}
            className="h-8 flex items-center gap-1.5 px-2.5 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] hover:border-[var(--color-accent)]/50 transition-all shrink-0 whitespace-nowrap"
            title="查看或下载 CA 根证书"
          >
            <Shield
              size={13}
              className="text-amber-400 shrink-0"
            />
            <span>CA 证书</span>
          </button>

          {/* 自动滚动 */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg border text-xs font-medium transition-all shrink-0 whitespace-nowrap ${
              autoScroll
                ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/40 text-[var(--color-accent)]'
                : 'bg-[var(--color-bg-tertiary)] border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
            title={autoScroll ? '已启用自动滚动' : '已暂停自动滚动'}
          >
            <ArrowDown
              size={13}
              className={autoScroll ? 'animate-bounce shrink-0' : 'shrink-0'}
            />
            <span>自动滚动</span>
          </button>

          {/* 清空请求 */}
          <button
            onClick={handleClear}
            className="h-8 flex items-center gap-1.5 px-2.5 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10 transition-all shrink-0 whitespace-nowrap"
            title="清空当前所有捕获请求"
          >
            <Trash2
              size={13}
              className="shrink-0"
            />
            <span>清空</span>
          </button>
        </div>
      </div>

      {/* 搜索与过滤行 */}
      <div className="flex items-center gap-2.5 px-4 py-1.5 bg-[var(--color-bg-secondary)]/40 border-t border-[var(--color-border-muted)]">
        {/* Method Filter 下拉 */}
        <div className="relative shrink-0">
          <select
            value={filter.method || 'ALL'}
            onChange={e =>
              setFilter({
                method: e.target.value === 'ALL' ? '' : e.target.value,
              })
            }
            className="appearance-none h-7 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] text-xs font-mono font-bold text-[var(--color-text-primary)] rounded-lg pl-2.5 pr-6 py-0 focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
          >
            {METHODS.map(m => (
              <option
                key={m}
                value={m}
                className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              >
                {m}
              </option>
            ))}
          </select>
          <ChevronDown
            size={11}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
          />
        </div>

        {/* URL / 路径 / 状态码搜索输入框 */}
        <div
          ref={searchContainerRef}
          className="flex-1 relative min-w-[200px]"
        >
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
          />
          <input
            type="text"
            placeholder="过滤请求 URL、路径或使用 mitmproxy 语法 (如 ~m POST & ~c 200, !~a, ~d)..."
            value={filter.search}
            onChange={e => handleSearchChange(e.target.value)}
            onFocus={() => {
              if (
                filter.search.includes('~') &&
                !filterHelpDismissedRef.current
              ) {
                setShowFilterHelp(true);
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                filterHelpDismissedRef.current = true;
                setShowFilterHelp(false);
              }
            }}
            className="w-full h-7 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg pl-7 pr-14 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-all font-mono"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {filter.search && (
              <button
                onClick={() => setFilter({search: ''})}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-0.5"
                title="清空搜索"
              >
                <X size={12} />
              </button>
            )}
            <button
              onClick={() => setShowFilterHelp(prev => !prev)}
              className={`p-0.5 rounded transition-colors ${
                showFilterHelp
                  ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/15'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
              title="查看 mitmproxy 过滤表达式语法帮助 (~)"
            >
              <Filter size={12} />
            </button>
          </div>

          {/* 类似 mitmproxy 的过滤语法悬浮下拉面板 */}
          {showFilterHelp && (
            <div className="absolute left-0 top-full mt-1.5 w-[390px] max-w-[90vw] bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg shadow-2xl z-50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-bg-tertiary)] border-b border-[var(--color-border-default)] text-[11px] font-medium text-[var(--color-text-secondary)]">
                <span className="flex items-center gap-1.5 font-mono">
                  <span className="text-[var(--color-accent)] font-bold">
                    ~
                  </span>
                  <span>Flow Filter 过滤表达式</span>
                </span>
                <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                  支持 ! & | ()
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-[var(--color-border-muted)]/40">
                {filteredSuggestions.map(item => (
                  <button
                    key={item.code}
                    onClick={() => insertFilterSuggestion(item)}
                    className="w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-[var(--color-accent)]/10 transition-colors group cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs font-bold text-sky-400 group-hover:text-[var(--color-accent)] shrink-0">
                        {item.syntax}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-secondary)] truncate">
                        {item.description}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-muted)] font-mono shrink-0 pl-2">
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 统计与状态指示区 */}
        <div className="flex items-center gap-3 text-xs font-mono text-[var(--color-text-muted)] shrink-0 whitespace-nowrap">
          {isRunning && (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              代理 :{status?.port ?? inputPort}
            </span>
          )}
          {cdpEnabled && (
            <span className="flex items-center gap-1.5 text-sky-400">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              CDP 活跃
            </span>
          )}
          <span>
            共{' '}
            <strong className="text-[var(--color-text-primary)]">
              {totalRequests}
            </strong>{' '}
            条
          </span>
          {selectedIds.length > 0 && (
            <span className="text-[var(--color-accent)] font-medium">
              · 已选 {selectedIds.length} 条
            </span>
          )}
        </div>
      </div>

      {/* 错误提示条 */}
      {errorMsg && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-rose-500/10 border-t border-rose-500/20 text-rose-400 text-xs">
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="hover:text-rose-300"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
};
