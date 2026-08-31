/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ArrowDown,
  ChevronDown,
  Loader2,
  Play,
  Search,
  Shield,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import React, {useState} from 'react';
import {useNavigate} from 'react-router-dom';

import {api} from '../../lib/api';
import type {SessionAnalysisMode} from '../../lib/protocol';
import {useAnalysisStore} from '../../stores/analysis';
import {useProxyStore} from '../../stores/proxy';

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
  const {
    status,
    autoScroll,
    filter,
    sourceFilter,
    pages,
    selectedPageId,
    selectedIds,
    setStatus,
    setAutoScroll,
    setFilter,
    setSourceFilter,
    selectTab,
    clearRequests,
  } = useProxyStore();

  const analysisMode = useAnalysisStore(state => state.mode);
  const setAnalysisMode = useAnalysisStore(state => state.setMode);
  const setReport = useAnalysisStore(state => state.setReport);
  const setAnalyzing = useAnalysisStore(state => state.setAnalyzing);
  const setAnalysisError = useAnalysisStore(state => state.setError);
  const navigate = useNavigate();

  const [inputPort, setInputPort] = useState<number>(status?.port ?? 8888);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzingLocal] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isRunning = status?.running ?? false;

  const handleAnalyzeSelected = async () => {
    setAnalyzingLocal(true);
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const result = await api.analyzeSession({
        mode: analysisMode,
        requestIds: selectedIds,
      });
      setReport(result);
      void navigate('/report');
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'AI 分析失败');
    } finally {
      setAnalyzingLocal(false);
      setAnalyzing(false);
    }
  };

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

  return (
    <div className="flex flex-col border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/80 backdrop-blur-md px-4 py-2.5 gap-2.5">
      {/* Top action row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Start/Stop + Port + Status */}
        <div className="flex items-center gap-3">
          {/* Start/Stop Button */}
          <button
            onClick={handleToggleProxy}
            disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${
              isRunning
                ? 'bg-rose-500/15 border border-rose-500/30 text-rose-400 hover:bg-rose-500/25 hover:border-rose-500/50'
                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 hover:border-emerald-500/50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading ? (
              <Loader2
                size={14}
                className="animate-spin"
              />
            ) : isRunning ? (
              <Square
                size={14}
                className="fill-current"
              />
            ) : (
              <Play
                size={14}
                className="fill-current"
              />
            )}
            <span>{isRunning ? '停止代理' : '启动抓包'}</span>
          </button>

          {/* Tab Selector */}
          <div className="flex items-center gap-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] px-2.5 py-1.5 rounded-xl">
            <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
              标签页:
            </span>
            <select
              value={selectedPageId ?? ''}
              onChange={e => {
                const id = e.target.value;
                if (id) void selectTab(id);
              }}
              className="bg-transparent text-xs font-mono text-[var(--color-text-primary)] focus:outline-none"
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

          {/* Port Input */}
          <div className="flex items-center gap-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] px-2.5 py-1.5 rounded-xl">
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
              className="w-16 bg-transparent text-xs font-mono text-[var(--color-text-primary)] focus:outline-none disabled:text-[var(--color-text-muted)]"
            />
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--color-bg-primary)]/70 border border-[var(--color-border-default)]">
            <span
              className={`w-2 h-2 rounded-full ${
                isRunning
                  ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50'
                  : 'bg-[var(--color-text-muted)]'
              }`}
            />
            <span className="text-xs font-mono font-medium text-[var(--color-text-secondary)]">
              {isRunning ? `运行中 :${status?.port}` : '已停止'}
            </span>
          </div>
        </div>

        {/* Right: CA modal button + Auto scroll + Clear */}
        <div className="flex items-center gap-2.5">
          {/* AI analysis mode */}
          <div className="relative">
            <select
              value={analysisMode}
              onChange={e =>
                setAnalysisMode(e.target.value as SessionAnalysisMode)
              }
              className="appearance-none bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] text-xs font-mono text-[var(--color-text-primary)] rounded-xl pl-3 pr-8 py-1.5 focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
              title="AI 分析模式"
            >
              <option
                value="auto"
                className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              >
                自动检测
              </option>
              <option
                value="api_reverse"
                className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              >
                接口逆向
              </option>
              <option
                value="security"
                className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              >
                安全审查
              </option>
              <option
                value="perf"
                className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              >
                性能分析
              </option>
              <option
                value="js_crypto"
                className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              >
                JS 加密
              </option>
            </select>
            <ChevronDown
              size={12}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
            />
          </div>

          {/* AI analyze selected button */}
          <button
            onClick={handleAnalyzeSelected}
            disabled={analyzing || selectedIds.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/40 text-[var(--color-accent)] text-xs font-medium hover:bg-[var(--color-accent)]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            title={
              selectedIds.length > 0
                ? `AI 分析已选 ${selectedIds.length} 条请求`
                : '勾选左侧请求后发起 AI 分析'
            }
          >
            {analyzing ? (
              <Loader2
                size={13}
                className="animate-spin"
              />
            ) : (
              <Sparkles size={13} />
            )}
            <span>
              {analyzing
                ? '分析中…'
                : selectedIds.length > 0
                  ? `分析已选 ${selectedIds.length} 条`
                  : 'AI 分析'}
            </span>
          </button>

          {/* CA Certificate Button */}
          <button
            onClick={onOpenCaModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] hover:border-[var(--color-accent)]/50 transition-all"
          >
            <Shield
              size={13}
              className="text-amber-400"
            />
            <span>CA 证书</span>
          </button>

          {/* Auto Scroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
              autoScroll
                ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/40 text-[var(--color-accent)]'
                : 'bg-[var(--color-bg-tertiary)] border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
            title={autoScroll ? '已启用自动滚动到最新请求' : '已暂停自动滚动'}
          >
            <ArrowDown
              size={13}
              className={autoScroll ? 'animate-bounce' : ''}
            />
            <span>自动滚动</span>
          </button>

          {/* Clear Requests Button */}
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10 transition-all"
            title="清空当前所有捕获请求"
          >
            <Trash2 size={13} />
            <span>清空</span>
          </button>
        </div>
      </div>

      {/* Bottom filter row */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Source Filter */}
        <div className="relative">
          <select
            value={sourceFilter}
            onChange={e =>
              setSourceFilter(e.target.value as 'all' | 'cdp' | 'proxy')
            }
            className="appearance-none bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] text-xs font-mono font-bold text-[var(--color-text-primary)] rounded-xl pl-3 pr-8 py-1.5 focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
          >
            <option
              value="all"
              className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
            >
              全部
            </option>
            <option
              value="cdp"
              className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
            >
              CDP
            </option>
            <option
              value="proxy"
              className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
            >
              MITM
            </option>
          </select>
          <ChevronDown
            size={12}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
          />
        </div>

        {/* Method Filter Dropdown */}
        <div className="relative">
          <select
            value={filter.method || 'ALL'}
            onChange={e =>
              setFilter({
                method: e.target.value === 'ALL' ? '' : e.target.value,
              })
            }
            className="appearance-none bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] text-xs font-mono font-bold text-[var(--color-text-primary)] rounded-xl pl-3 pr-8 py-1.5 focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
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
            size={12}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
          />
        </div>

        {/* URL Search input */}
        <div className="flex-1 relative min-w-[200px]">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
          />
          <input
            type="text"
            placeholder="过滤请求 URL、路径或域名 (例如 /api/v1 或 example.com)..."
            value={filter.search}
            onChange={e => setFilter({search: e.target.value})}
            className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-xl pl-8 pr-8 py-1.5 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-all font-mono"
          />
          {filter.search && (
            <button
              onClick={() => setFilter({search: ''})}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Error prompt if any */}
      {errorMsg && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
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
