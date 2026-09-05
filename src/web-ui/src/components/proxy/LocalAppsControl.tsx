/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AlertTriangle,
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import React, {useEffect, useRef, useState} from 'react';

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
    try {
      const updated = await api.configureLocalApps({enabled: checked});
      setLocalApps(updated);
    } catch (err) {
      console.error('切换 Local Apps 失败:', err);
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
    if (!isEnabled) return;
    setPopoverOpen(prev => !prev);
    if (!popoverOpen) {
      void refreshProcesses();
    }
  };

  const filteredProcesses = processes.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div
      ref={popoverRef}
      className="relative flex items-center gap-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] px-2.5 py-1.5 rounded-xl text-xs"
    >
      {/* 拦截本地应用 checkbox */}
      <label
        className={`flex items-center gap-1.5 select-none ${
          isUnsupported ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
        }`}
        title={isUnsupported ? '当前平台不支持系统代理接管' : undefined}
      >
        <input
          type="checkbox"
          checked={isEnabled}
          disabled={isUnsupported || loading}
          onChange={e => void handleToggleEnabled(e.target.checked)}
          className="rounded border-[var(--color-border-default)] text-emerald-500 focus:ring-0 cursor-pointer"
        />
        <span className="font-medium text-[var(--color-text-secondary)] whitespace-nowrap">
          拦截本地应用
        </span>
      </label>

      {/* 状态指示器与 targets 控制区 */}
      <div
        className={`flex items-center gap-2 transition-opacity ${
          isEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'
        }`}
      >
        {/* 状态徽章 */}
        {isEnabled && (
          <>
            {isDegraded ? (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-500 border border-amber-500/20 whitespace-nowrap"
                title="netstat 连接表连续刷新失败，进程识别可能不可靠"
              >
                <AlertTriangle className="w-3 h-3" />
                进程识别不可靠
              </span>
            ) : localApps?.systemProxyActive ? (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 whitespace-nowrap">
                已接管系统代理
              </span>
            ) : null}
          </>
        )}

        {/* 拦截目标展示 */}
        <div className="flex items-center gap-1 overflow-x-auto max-w-[200px] scrollbar-none">
          {targets.length === 0 ? (
            <button
              type="button"
              onClick={handleOpenPopover}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] border border-dashed border-[var(--color-border-default)] whitespace-nowrap"
            >
              全部应用
              <ChevronDown className="w-3 h-3" />
            </button>
          ) : (
            targets.map(t => (
              <span
                key={t}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] shrink-0"
              >
                {t}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    void handleRemoveTarget(t);
                  }}
                  className="hover:text-red-400"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))
          )}
        </div>

        {/* 添加目标 Popover 触发按钮 */}
        <button
          type="button"
          onClick={handleOpenPopover}
          title="选择或添加目标应用"
          className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ProcessPicker Popover */}
      {popoverOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-xl shadow-xl z-50 p-2 text-xs">
          {/* 搜索与自定义添加 */}
          <div className="flex items-center gap-1.5 pb-2 border-b border-[var(--color-border-default)]">
            <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
            <input
              type="text"
              value={searchTerm}
              placeholder="搜索或输入进程名回车..."
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddCustomTarget();
                }
              }}
              className="w-full bg-transparent text-xs text-[var(--color-text-primary)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void refreshProcesses()}
              title="刷新网络进程列表"
              className="p-1 hover:bg-[var(--color-bg-secondary)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {/* 活跃网络进程列表 */}
          <div className="max-h-56 overflow-y-auto py-1.5 flex flex-col gap-0.5">
            {filteredProcesses.length === 0 ? (
              <div className="py-3 text-center text-[var(--color-text-muted)] text-[11px]">
                {searchTerm ? '回车添加为自定义目标' : '无活跃网络连接'}
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
                    className="flex items-center justify-between px-2 py-1 hover:bg-[var(--color-bg-secondary)] rounded cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          void handleToggleTarget(p.name, checked)
                        }
                        className="rounded border-[var(--color-border-default)] text-emerald-500 focus:ring-0"
                      />
                      <span className="font-mono text-[11px] truncate">
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
