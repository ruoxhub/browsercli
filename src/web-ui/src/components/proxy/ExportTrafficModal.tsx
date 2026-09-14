/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Check,
  Download,
  FileCode,
  FileJson,
  Loader2,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import React, {useEffect, useMemo, useRef, useState} from 'react';

import {api, type ExportSessionTrafficParams} from '../../lib/api';
import {useProxyStore} from '../../stores/proxy';

export type ExportScope = 'selected' | 'filtered' | 'all';
export type ExportFormat = 'har' | 'json' | 'curl';

interface ExportTrafficModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialScope?: ExportScope;
  /** 当前列表可见（过滤后）的请求数，用于「当前过滤」计数显示。 */
  filteredCount?: number;
  /** 当前列表可见的请求 ID，用于「当前过滤」按 ID 精确导出。 */
  filteredIds?: string[];
}

export const ExportTrafficModal: React.FC<ExportTrafficModalProps> = ({
  isOpen,
  onClose,
  initialScope = 'all',
  filteredCount,
  filteredIds,
}) => {
  const selectedIds = useProxyStore(s => s.selectedIds);
  const totalRequests = useProxyStore(s => s.requests.length);
  const filter = useProxyStore(s => s.filter);
  const cdpEnabled = useProxyStore(s => s.cdpEnabled);
  const mitmRunning = useProxyStore(s => s.status?.running ?? false);

  const [scope, setScope] = useState<ExportScope>(initialScope);
  const [format, setFormat] = useState<ExportFormat>('har');
  const [includeResponseBody, setIncludeResponseBody] = useState<boolean>(true);
  const [desensitize, setDesensitize] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 当弹窗打开时，根据当前选择状态自适应设置默认 scope
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
      if (selectedIds.length > 0) {
        setScope('selected');
      } else if (
        initialScope === 'filtered' ||
        filter.search.trim() ||
        filter.method
      ) {
        setScope('filtered');
      } else {
        setScope('all');
      }
    }
  }, [isOpen, initialScope, selectedIds.length, filter.search, filter.method]);

  // 导出成功后自动关闭；组件卸载或提前关闭时清掉定时器，避免对已卸载组件回调。
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const activeFilteredCount = filteredCount ?? totalRequests;

  const targetCount = useMemo(() => {
    switch (scope) {
      case 'selected':
        return selectedIds.length;
      case 'filtered':
        return activeFilteredCount;
      case 'all':
      default:
        return totalRequests;
    }
  }, [scope, selectedIds.length, activeFilteredCount, totalRequests]);

  if (!isOpen) return null;

  const handleStartExport = async () => {
    setExporting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const sources: string[] = [];
      if (cdpEnabled) sources.push('cdp');
      if (mitmRunning) sources.push('proxy');

      const params: ExportSessionTrafficParams = {
        format,
        includeResponseBody,
        desensitize,
        sources: sources.length > 0 ? sources : undefined,
      };

      if (scope === 'selected') {
        if (selectedIds.length === 0) {
          throw new Error('未选择任何请求');
        }
        params.ids = selectedIds;
      } else if (scope === 'filtered') {
        // 列表可见项由 source/method/search 多重过滤得出，服务端无法完整复算；
        // 直接按可见 ID 导出，保证导出集合与界面显示一致。
        if (filteredIds && filteredIds.length > 0) {
          params.ids = filteredIds;
        } else if (filter.search.trim()) {
          params.filter = filter.search.trim();
        }
      }

      const result = await api.downloadSessionTraffic(params);
      setSuccessMsg(
        `导出成功！共导出 ${result.count} 条请求 (${result.filename})`,
      );
      closeTimerRef.current = setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      console.error('Export traffic error:', err);
      setErrorMsg(err instanceof Error ? err.message : '导出流量失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)]/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30 flex items-center justify-center text-[var(--color-accent)]">
              <Download size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                导出流量抓包数据
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)]">
                支持将捕获的网络请求导出为 HAR、JSON 或 cURL 批处理脚本
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {/* Section 1: 导出范围 */}
          <div className="space-y-2.5">
            <div className="font-bold text-[var(--color-text-primary)] flex items-center gap-1.5">
              <span>1. 导出范围</span>
              <span className="text-[11px] font-normal text-[var(--color-text-muted)]">
                (当前共有 {totalRequests} 条捕获流量)
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {/* 已选请求 */}
              <button
                type="button"
                onClick={() => setScope('selected')}
                disabled={selectedIds.length === 0}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  scope === 'selected'
                    ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-text-primary)] shadow-sm'
                    : 'bg-[var(--color-bg-primary)] border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-bold text-xs flex items-center gap-1">
                    <Check
                      size={12}
                      className={
                        scope === 'selected'
                          ? 'opacity-100 text-[var(--color-accent)]'
                          : 'opacity-0'
                      }
                    />
                    已选请求
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]">
                    {selectedIds.length} 条
                  </span>
                </div>
                <span className="text-[10px] text-[var(--color-text-muted)] leading-tight">
                  仅导出列表中勾选的条目
                </span>
              </button>

              {/* 当前过滤结果 */}
              <button
                type="button"
                onClick={() => setScope('filtered')}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  scope === 'filtered'
                    ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-text-primary)] shadow-sm'
                    : 'bg-[var(--color-bg-primary)] border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-bold text-xs flex items-center gap-1">
                    <Check
                      size={12}
                      className={
                        scope === 'filtered'
                          ? 'opacity-100 text-[var(--color-accent)]'
                          : 'opacity-0'
                      }
                    />
                    当前过滤
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]">
                    {activeFilteredCount} 条
                  </span>
                </div>
                <span
                  className="text-[10px] text-[var(--color-text-muted)] leading-tight truncate w-full"
                  title={filter.search || '匹配搜索条件'}
                >
                  {filter.search ? `"${filter.search}"` : '匹配当前筛选'}
                </span>
              </button>

              {/* 全部请求 */}
              <button
                type="button"
                onClick={() => setScope('all')}
                disabled={totalRequests === 0}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  scope === 'all'
                    ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-text-primary)] shadow-sm'
                    : 'bg-[var(--color-bg-primary)] border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-bold text-xs flex items-center gap-1">
                    <Check
                      size={12}
                      className={
                        scope === 'all'
                          ? 'opacity-100 text-[var(--color-accent)]'
                          : 'opacity-0'
                      }
                    />
                    全部捕获
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]">
                    {totalRequests} 条
                  </span>
                </div>
                <span className="text-[10px] text-[var(--color-text-muted)] leading-tight">
                  导出所有捕获流量
                </span>
              </button>
            </div>
          </div>

          {/* Section 2: 导出格式 */}
          <div className="space-y-2.5">
            <div className="font-bold text-[var(--color-text-primary)]">
              2. 导出格式
            </div>
            <div
              className="space-y-2"
              role="radiogroup"
            >
              {/* HAR 1.2 */}
              <button
                type="button"
                role="radio"
                aria-checked={format === 'har'}
                onClick={() => setFormat('har')}
                className={`w-full flex items-start gap-3 p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                  format === 'har'
                    ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-text-primary)]'
                    : 'bg-[var(--color-bg-primary)] border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]'
                }`}
              >
                <div
                  className={`p-2 rounded-lg shrink-0 mt-0.5 ${format === 'har' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]'}`}
                >
                  <FileCode size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs">
                      HAR 1.2 归档格式 (.har)
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[9px] font-bold">
                      推荐
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed text-left">
                    行业标准 HTTP 流量归档格式。可直接导入 Chrome
                    DevTools、Charles、Proxyman、Reqable、Postman 或 mitmproxy
                    查看完整时序与交互。
                  </p>
                </div>
              </button>

              {/* JSON */}
              <button
                type="button"
                role="radio"
                aria-checked={format === 'json'}
                onClick={() => setFormat('json')}
                className={`w-full flex items-start gap-3 p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                  format === 'json'
                    ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-text-primary)]'
                    : 'bg-[var(--color-bg-primary)] border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]'
                }`}
              >
                <div
                  className={`p-2 rounded-lg shrink-0 mt-0.5 ${format === 'json' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]'}`}
                >
                  <FileJson size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-xs">
                    完整结构化数据 (.json)
                  </span>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed text-left">
                    包含请求标头、请求体、响应标头、响应体、耗时及状态码的 JSON
                    数组。结构清晰，最适合二次开发、Python 脚本或自动化分析。
                  </p>
                </div>
              </button>

              {/* cURL */}
              <button
                type="button"
                role="radio"
                aria-checked={format === 'curl'}
                onClick={() => setFormat('curl')}
                className={`w-full flex items-start gap-3 p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                  format === 'curl'
                    ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-text-primary)]'
                    : 'bg-[var(--color-bg-primary)] border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]'
                }`}
              >
                <div
                  className={`p-2 rounded-lg shrink-0 mt-0.5 ${format === 'curl' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]'}`}
                >
                  <Terminal size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-xs">cURL 重放脚本 (.sh)</span>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed text-left">
                    可执行的 Bash 脚本文件，包含所有选中请求的完整 curl
                    命令行重放调用，可在任意 Linux/macOS/Git Bash
                    终端快速重现请求。
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Section 3: 选项配置 */}
          <div className="space-y-2.5">
            <div className="font-bold text-[var(--color-text-primary)]">
              3. 导出选项
            </div>
            <div className="p-3.5 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeResponseBody}
                  onChange={e => setIncludeResponseBody(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 rounded border border-[var(--color-border-default)] accent-[var(--color-accent)] cursor-pointer"
                />
                <div className="flex-1">
                  <span className="font-medium text-[var(--color-text-primary)] text-xs block">
                    包含响应体数据 (Response Body)
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)] block mt-0.5">
                    若取消勾选仅导出标头及元数据，可大幅减小导出的文件体积。
                  </span>
                </div>
              </label>

              <div className="h-px bg-[var(--color-border-muted)]" />

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={desensitize}
                  onChange={e => setDesensitize(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 rounded border border-[var(--color-border-default)] accent-[var(--color-accent)] cursor-pointer"
                />
                <div className="flex-1">
                  <span className="font-medium text-[var(--color-text-primary)] text-xs block flex items-center gap-1.5">
                    <span>敏感凭据脱敏保护</span>
                    <ShieldCheck
                      size={12}
                      className="text-emerald-400"
                    />
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)] block mt-0.5">
                    自动将 Cookie、Authorization、Token、Secret
                    等敏感认证标头替换为
                    [REDACTED]。仅覆盖标头，不扫描请求/响应正文。
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* 提示/错误条 */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs flex items-center gap-2">
              <Check
                size={14}
                className="shrink-0"
              />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)]/50">
          <div className="text-[11px] text-[var(--color-text-muted)]">
            即将导出{' '}
            <strong className="text-[var(--color-accent)] font-mono">
              {targetCount}
            </strong>{' '}
            条请求为{' '}
            <strong className="text-[var(--color-text-primary)] uppercase font-mono">
              .{format}
            </strong>{' '}
            文件
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={exporting}
              className="px-4 py-2 rounded-xl text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleStartExport}
              disabled={exporting || targetCount === 0}
              className="px-5 py-2 rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-[var(--color-accent)]/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {exporting ? (
                <>
                  <Loader2
                    size={13}
                    className="animate-spin"
                  />
                  <span>导出中...</span>
                </>
              ) : (
                <>
                  <Download size={13} />
                  <span>开始导出</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
