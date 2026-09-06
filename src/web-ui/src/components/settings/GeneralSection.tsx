/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Check,
  Copy,
  Download,
  FileDown,
  FileUp,
  Info,
  RotateCcw,
} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {api} from '../../lib/api';
import type {LogContent, SystemInfo} from '../../lib/protocol';

interface GeneralSectionProps {
  onReloadConfig: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const d = days > 0 ? `${days}d ` : '';
  const h = (hours % 24).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${d}${h}:${m}:${s}`;
}

export function GeneralSection({
  onReloadConfig,
  onError,
  onNotice,
}: GeneralSectionProps) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [log, setLog] = useState<LogContent | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadInfo = async () => {
    try {
      setInfo(await api.getSystemInfo());
    } catch (err) {
      onError(err instanceof Error ? err.message : '获取系统信息失败');
    }
  };

  useEffect(() => {
    void loadInfo();
    // 组件按导航懒挂载，挂载即拉取；刷新靠父级的「刷新配置」按钮重新挂载本区
  }, []);

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      onError(err instanceof Error ? err.message : '复制失败');
    }
  };

  const handleViewLog = async (name: string) => {
    setBusy(true);
    try {
      setLog(await api.getSystemLog(name));
    } catch (err) {
      onError(err instanceof Error ? err.message : '读取日志失败');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const data = await api.exportConfig();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `proxycli-config-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      onNotice('配置已导出（API Key 为掩码占位符，迁移后需手动填写）');
    } catch (err) {
      onError(err instanceof Error ? err.message : '导出配置失败');
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      await api.importConfig(parsed);
      onNotice('配置已导入并合并（合并语义：文件中缺失的字段保留当前值）');
      onReloadConfig();
      void loadInfo();
    } catch (err) {
      onError(err instanceof Error ? err.message : '导入配置失败');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReset = async () => {
    // 重置是破坏性操作，走原生 window.confirm 二次确认（本项目首例）。
    if (
      !window.confirm('确定重置为启动时的默认配置？这将删除本地缓存的配置。')
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.resetConfig();
      onNotice('配置已重置为启动默认值');
      onReloadConfig();
      void loadInfo();
    } catch (err) {
      onError(err instanceof Error ? err.message : '重置配置失败');
    } finally {
      setBusy(false);
    }
  };

  const envRows: Array<{label: string; value: string}> = info
    ? [
        {label: '版本', value: info.version},
        {label: 'Node', value: info.node},
        {label: '平台', value: info.platform},
        {label: '架构', value: info.arch},
        {label: 'PID', value: String(info.pid)},
        {label: '运行时间', value: formatUptime(info.uptimeMs)},
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Info
          className="text-[var(--color-accent)]"
          size={20}
        />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          通用
        </h2>
      </div>

      {/* 环境信息 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {envRows.map(row => (
          <div
            key={row.label}
            className="p-3 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]"
          >
            <div className="text-[11px] text-[var(--color-text-muted)]">
              {row.label}
            </div>
            <div className="text-xs font-mono text-[var(--color-text-primary)] mt-1">
              {row.value}
            </div>
          </div>
        ))}
      </div>

      {/* 配置文件与日志目录 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]">
          <div className="min-w-0">
            <div className="text-[11px] text-[var(--color-text-muted)]">
              配置文件
            </div>
            <div className="text-xs font-mono text-[var(--color-text-primary)] truncate">
              {info?.configPath ?? '—'}
            </div>
          </div>
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ml-3 ${
              info?.configExists
                ? 'bg-emerald-500/10 text-[var(--color-status-green)] border-emerald-500/20'
                : 'bg-zinc-500/10 text-[var(--color-text-muted)] border-zinc-500/20'
            }`}
          >
            {info?.configExists ? '已存在' : '未创建'}
          </span>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]">
          <div className="min-w-0">
            <div className="text-[11px] text-[var(--color-text-muted)]">
              日志目录
            </div>
            <div className="text-xs font-mono text-[var(--color-text-primary)] truncate">
              {info?.logDir ?? '—'}
            </div>
          </div>
          <button
            onClick={() => info && void copyText(info.logDir, 'logDir')}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] shrink-0 ml-3"
            title="复制日志目录路径"
          >
            {copied === 'logDir' ? (
              <Check
                size={14}
                className="text-emerald-400"
              />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
      </div>

      {/* 日志文件列表 */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[var(--color-text-secondary)]">
          日志文件
        </h3>
        {!info || info.logFiles.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">暂无日志文件</p>
        ) : (
          <div className="space-y-1">
            {info.logFiles.map(f => (
              <div
                key={f.name}
                className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]"
              >
                <div className="min-w-0">
                  <div className="text-xs font-mono text-[var(--color-text-primary)] truncate">
                    {f.name}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)]">
                    {formatBytes(f.sizeBytes)} ·{' '}
                    {new Date(f.mtimeMs).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <button
                    onClick={() => void handleViewLog(f.name)}
                    disabled={busy}
                    className="px-2 py-1 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                  >
                    查看
                  </button>
                  {/* 下载走浏览器原生下载，不经 api.ts —— 与 CaCertModal 的证书下载一致 */}
                  <a
                    href={`/api/system/logs/download?file=${encodeURIComponent(f.name)}`}
                    className="px-2 py-1 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] inline-flex items-center gap-1"
                  >
                    <Download size={11} />
                    下载
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
        {log && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                {log.fileName}
              </span>
              {log.truncated && (
                <span className="text-[11px] text-[var(--color-status-yellow)]">
                  已截断至最后 1 MiB
                </span>
              )}
            </div>
            <pre className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] font-mono text-[11px] text-[var(--color-text-primary)] overflow-auto max-h-64 whitespace-pre-wrap">
              {log.content}
            </pre>
          </div>
        )}
      </div>

      {/* 配置导出 / 导入 / 重置 */}
      <div className="space-y-2 border-t border-[var(--color-border-muted)] pt-4">
        <h3 className="text-xs font-semibold text-[var(--color-text-secondary)]">
          配置管理
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExport}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <FileDown size={12} />
            导出配置
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <FileUp size={12} />
            导入配置
          </button>
          <button
            onClick={handleReset}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-[var(--color-status-red)] hover:bg-red-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <RotateCcw size={12} />
            重置配置
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
          }}
        />
        <p className="text-[11px] text-[var(--color-text-muted)]">
          导出文件里的 API Key 恒为掩码占位符，导入时不会覆盖已保存的真实密钥。
          重置会删除本地缓存文件并回到启动时的配置（环境变量 + CLI 参数）。
        </p>
      </div>
    </div>
  );
}
