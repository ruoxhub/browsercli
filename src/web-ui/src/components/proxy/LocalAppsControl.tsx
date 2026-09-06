/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AlertTriangle,
  ChevronDown,
  Laptop,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import React, {useEffect, useMemo, useRef, useState} from 'react';

import {api} from '../../lib/api';
import {useProxyStore} from '../../stores/proxy';

export const LocalAppsControl: React.FC = () => {
  const localApps = useProxyStore(s => s.localApps);
  const setLocalApps = useProxyStore(s => s.setLocalApps);
  const processes = useProxyStore(s => s.processes);
  const refreshProcesses = useProxyStore(s => s.refreshProcesses);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getLocalApps()
      .then(setLocalApps)
      .catch(() => undefined);
  }, [setLocalApps]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    if (popoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [popoverOpen]);

  const isEnabled = localApps?.enabled ?? false;
  const isUnsupported = localApps?.systemProxyUnsupported ?? false;
  const isDegraded = localApps?.trackerDegraded ?? false;
  const targets = localApps?.targets ?? [];

  const handleToggleEnabled = async (checked: boolean) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const updated = await api.configureLocalApps({enabled: checked});
      setLocalApps(updated);
    } catch (err) {
      console.error('切换 Local Apps 失败:', err);
      setErrorMsg(err instanceof Error ? err.message : '切换失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTarget = async (targetToRemove: string) => {
    const nextTargets = targets.filter(t => t !== targetToRemove);
    try {
      const updated = await api.configureLocalApps({targets: nextTargets});
      setLocalApps(updated);
    } catch (err) {
      console.error('移除拦截目标失败:', err);
    }
  };

  const handleToggleTarget = async (procName: string, isTarget: boolean) => {
    const nextTargets = isTarget
      ? targets.filter(
          t =>
            t.toLowerCase() !== procName.toLowerCase() &&
            t.toLowerCase() !== procName.toLowerCase().replace(/\.exe$/, ''),
        )
      : [...targets, procName];
    try {
      const updated = await api.configureLocalApps({targets: nextTargets});
      setLocalApps(updated);
    } catch (err) {
      console.error('配置拦截目标失败:', err);
    }
  };

  const handleAddCustomTarget = async () => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    const exists = targets.some(
      t =>
        t.toLowerCase() === trimmed.toLowerCase() ||
        t.toLowerCase() === trimmed.toLowerCase().replace(/\.exe$/, ''),
    );
    if (!exists) {
      const nextTargets = [...targets, trimmed];
      try {
        const updated = await api.configureLocalApps({targets: nextTargets});
        setLocalApps(updated);
        setSearchTerm('');
      } catch (err) {
        console.error('添加自定义目标失败:', err);
      }
    }
  };

  const handleOpenPopover = () => {
    setPopoverOpen(prev => !prev);
    if (!popoverOpen) {
      void refreshProcesses();
    }
  };

  const filteredProcesses = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const matched = processes.filter(
      p => p.name.toLowerCase().includes(term) || String(p.pid).includes(term),
    );
    // 排序：已勾选目标置顶；优先普通应用，系统服务与未命名进程置底
    return [...matched].sort((a, b) => {
      const aChecked = targets.some(
        t =>
          t.toLowerCase() === a.name.toLowerCase() ||
          t.toLowerCase() === a.name.toLowerCase().replace(/\.exe$/, ''),
      );
      const bChecked = targets.some(
        t =>
          t.toLowerCase() === b.name.toLowerCase() ||
          t.toLowerCase() === b.name.toLowerCase().replace(/\.exe$/, ''),
      );
      if (aChecked && !bChecked) return -1;
      if (!aChecked && bChecked) return 1;

      const aIsSys =
        a.name === 'System' ||
        a.name === 'System Idle Process' ||
        a.name.toLowerCase().startsWith('svchost') ||
        a.name.startsWith('pid-');
      const bIsSys =
        b.name === 'System' ||
        b.name === 'System Idle Process' ||
        b.name.toLowerCase().startsWith('svchost') ||
        b.name.startsWith('pid-');
      if (!aIsSys && bIsSys) return -1;
      if (aIsSys && !bIsSys) return 1;

      return a.name.localeCompare(b.name);
    });
  }, [processes, searchTerm, targets]);

  return (
    <div
      ref={popoverRef}
      className="relative shrink-0 flex items-center"
    >
      {/* 顶栏组合控件：直接复选框 + 状态 + 目标配置触发按钮 */}
      <div
        className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg border text-xs font-medium transition-all shrink-0 whitespace-nowrap ${
          isEnabled
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-[var(--color-bg-primary)] border-[var(--color-border-default)]'
        }`}
      >
        {/* 拦截本地应用直接开关复选框 */}
        <label
          className={`flex items-center gap-1.5 select-none ${
            isUnsupported ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
          }`}
          title={
            isUnsupported
              ? '当前平台不支持系统代理接管'
              : isEnabled
                ? '点击关闭系统代理接管与本地应用拦截'
                : '点击开启系统代理接管，拦截本地应用程序流量'
          }
        >
          {loading ? (
            <Loader2
              size={13}
              className="animate-spin text-emerald-400"
            />
          ) : (
            <input
              type="checkbox"
              checked={isEnabled}
              disabled={isUnsupported || loading}
              onChange={e => void handleToggleEnabled(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-[var(--color-border-default)] text-emerald-500 accent-emerald-500 cursor-pointer disabled:cursor-not-allowed"
            />
          )}
          <span
            className={`font-medium transition-colors ${
              isEnabled
                ? 'text-emerald-400 font-bold'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            拦截本地应用
          </span>
        </label>

        {/* 状态徽章 */}
        {isEnabled && (
          <>
            {isDegraded ? (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap"
                title="netstat 连接表连续刷新失败，进程识别可能不可靠"
              >
                <AlertTriangle size={11} />
                不可靠
              </span>
            ) : localApps?.systemProxyActive ? (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 whitespace-nowrap"
                title="系统代理已成功接管并生效"
              >
                已接管
              </span>
            ) : null}
          </>
        )}

        {/* 目标应用下拉触发器 */}
        <button
          type="button"
          onClick={handleOpenPopover}
          className={`h-5 flex items-center gap-1 px-1.5 rounded text-[10px] font-mono transition-all cursor-pointer ${
            targets.length > 0
              ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] hover:border-[var(--color-accent)]/50'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] border border-dashed border-[var(--color-border-default)]'
          }`}
          title="点击选择或配置要拦截的目标进程"
        >
          <span>
            {targets.length === 0
              ? '全部应用'
              : targets.length === 1
                ? targets[0]
                : `${targets.length}个应用`}
          </span>
          <ChevronDown
            size={10}
            className="text-[var(--color-text-muted)]"
          />
        </button>
      </div>

      {/* ProcessPicker Popover 面板 */}
      {popoverOpen && (
        <div className="absolute top-full left-0 mt-1.5 w-84 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl shadow-2xl z-50 p-3 text-xs flex flex-col gap-2.5">
          {/* 标题栏与关闭 */}
          <div className="flex items-center justify-between pb-2 border-b border-[var(--color-border-default)]">
            <div className="flex items-center gap-1.5 font-bold text-[var(--color-text-primary)]">
              <Laptop size={14} />
              <span>目标应用拦截配置</span>
            </div>
            <button
              onClick={() => setPopoverOpen(false)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-0.5 rounded cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>

          {/* 错误提示 */}
          {errorMsg && (
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[11px]">
              <span>{errorMsg}</span>
              <button
                onClick={() => setErrorMsg(null)}
                className="hover:text-rose-300"
              >
                <X size={11} />
              </button>
            </div>
          )}

          {/* 目标进程展示与移除区 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--color-text-muted)] font-medium">
                拦截范围:
              </span>
              <span className="text-[var(--color-text-secondary)] font-mono">
                {targets.length === 0
                  ? '全部进程 (默认全部解密抓包)'
                  : `已指定 ${targets.length} 个应用 (其余直连放行)`}
              </span>
            </div>

            {targets.length > 0 ? (
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto py-0.5">
                {targets.map(t => (
                  <span
                    key={t}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] shrink-0"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        void handleRemoveTarget(t);
                      }}
                      className="hover:text-red-400 transition-colors cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[var(--color-text-muted)] italic">
                未选择特定目标时，将自动拦截并分析所有本地客户端的网络请求。
              </p>
            )}
          </div>

          {/* 搜索与自定义添加 */}
          <div className="flex items-center gap-1.5 pb-1.5 pt-1 border-t border-[var(--color-border-default)]">
            <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
            <input
              type="text"
              value={searchTerm}
              placeholder="搜索应用名称或输入进程名按回车添加..."
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddCustomTarget();
                }
              }}
              className="w-full bg-transparent text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none font-mono"
            />
            <button
              type="button"
              onClick={() => void refreshProcesses()}
              title="刷新网络进程列表"
              className="p-1 hover:bg-[var(--color-bg-primary)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] shrink-0 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {/* 活跃网络进程列表 */}
          <div className="max-h-48 overflow-y-auto py-1 flex flex-col gap-0.5 border-t border-[var(--color-border-muted)]">
            {filteredProcesses.length === 0 ? (
              <div className="py-4 text-center text-[var(--color-text-muted)] text-[11px]">
                {searchTerm ? '按回车直接添加自定义目标' : '无活跃网络连接'}
              </div>
            ) : (
              filteredProcesses.map(p => {
                const checked = targets.some(
                  t =>
                    t.toLowerCase() === p.name.toLowerCase() ||
                    t.toLowerCase() ===
                      p.name.toLowerCase().replace(/\.exe$/, ''),
                );
                return (
                  <label
                    key={`${p.name}-${p.pid}`}
                    className="flex items-center justify-between px-2 py-1 hover:bg-[var(--color-bg-primary)] rounded-md cursor-pointer select-none transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          void handleToggleTarget(p.name, checked)
                        }
                        className="rounded border-[var(--color-border-default)] text-emerald-500 accent-emerald-500 focus:ring-0 cursor-pointer"
                      />
                      <span className="font-mono text-[11px] text-[var(--color-text-primary)] truncate">
                        {p.name}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-muted)] font-mono ml-2 shrink-0">
                      pid: {p.pid}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
