/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Cpu,
  Clock,
  Globe,
  RefreshCw,
  Server,
  Layers,
  Wrench,
  Shield,
} from 'lucide-react';
import {useEffect, useState} from 'react';

import {RecentInvocations} from '../components/overview/RecentInvocations';
import {api} from '../lib/api';
import type {WorkerFullStatus} from '../lib/protocol';
import {wsClient} from '../lib/ws';
import {useInvocationsStore} from '../stores/invocations';

function formatUptime(ms: number): string {
  if (ms <= 0) return '00:00:00';
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

export default function OverviewPage() {
  const [status, setStatus] = useState<WorkerFullStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const addRecord = useInvocationsStore(state => state.addRecord);
  const setRecords = useInvocationsStore(state => state.setRecords);
  const [errorLogs, setErrorLogs] = useState<
    Array<{id: string; time: string; tool: string; message: string}>
  >([]);

  // 内部累加 Uptime
  useEffect(() => {
    if (!status) return;
    const interval = setInterval(() => {
      setStatus(prev => {
        if (!prev) return null;
        return {
          ...prev,
          uptime: prev.uptime + 1000,
        };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status !== null]);

  const fetchStatus = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await api.getWorkerStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch worker status:', err);
      setError(err instanceof Error ? err.message : '获取 Worker 状态失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    // 初始化获取最近 50 条历史记录
    api
      .getInvocations(50)
      .then(data => {
        if (data && data.records) {
          setRecords(data.records);
        }
      })
      .catch(err => {
        console.error('Failed to fetch historical invocations:', err);
      });

    // 订阅 worker.status 频道实现实时数据推送
    const unsubscribeStatus = wsClient.subscribe('worker.status', msg => {
      if (msg.type === 'snapshot' || msg.type === 'event') {
        setStatus(msg.payload as WorkerFullStatus);
        setLoading(false);
      }
    });

    // 订阅 WebSocket tool.invoke 频道实现实时工具调用监听
    const unsubscribeInvoke = wsClient.subscribe('tool.invoke', msg => {
      const payload = msg.payload as any; // 它是 ToolInvokeEvent
      if (payload && payload.traceId) {
        // 将 WS 接收到的事件包装为 InvocationRecord 并加入 store
        addRecord({
          id: `ws_${payload.traceId}_${payload.ts}`,
          traceId: payload.traceId,
          toolName: payload.toolName,
          success: payload.success,
          startedAt: new Date(payload.ts).toISOString(),
          durationMs: payload.durationMs || 0,
          error: payload.error,
        });

        // 实时捕获报错，写入终端错误日志流
        if (payload.success === false) {
          const errorMsg = payload.error?.message || '未知 RPC 错误';
          setErrorLogs(prev => {
            const newLogs = [
              {
                id: `err_${payload.traceId}_${payload.ts}`,
                time: new Date(payload.ts).toLocaleTimeString(),
                tool: payload.toolName,
                message: errorMsg,
              },
              ...prev,
            ];
            return newLogs.slice(0, 50);
          });
        }
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeInvoke();
    };
  }, [addRecord, setRecords]);

  if (loading) {
    return (
      <div className="flex-1 p-6 lg:p-8 space-y-6 animate-pulse">
        <div className="h-10 w-48 bg-[var(--color-border-muted)] rounded-lg mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="h-44 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl" />
          <div className="h-44 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl" />
          <div className="h-44 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl" />
        </div>
        <div className="h-64 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl" />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="flex-1 p-6 lg:p-8 flex flex-col items-center justify-center min-h-[400px]">
        <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-accent-red)]/30 rounded-xl p-8 max-w-md text-center shadow-xl">
          <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <Server
              className="text-[var(--color-accent-red)]"
              size={24}
            />
          </div>
          <h3 className="text-base font-medium text-[var(--color-text-primary)] mb-2">
            服务连接失败
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] mb-6">
            无法读取 Worker 控制台的 API 状态。请确保后端主服务在端口 8765
            已成功启动。
          </p>
          <button
            onClick={() => {
              setLoading(true);
              fetchStatus();
            }}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center justify-center mx-auto gap-2"
          >
            <RefreshCw size={14} />
            重试连接
          </button>
        </div>
      </div>
    );
  }

  const isWorkerOk = status?.ok ?? false;
  const isBrowserConnected = status?.browser?.connected ?? false;

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto space-y-8 select-none">
      {/* 顶部标题区 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-border-muted)] pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
              控制台概览
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                isWorkerOk
                  ? 'bg-emerald-500/10 text-[var(--color-status-green)] border-emerald-500/20'
                  : 'bg-red-500/10 text-[var(--color-status-red)] border-red-500/20'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${isWorkerOk ? 'bg-[var(--color-status-green)] animate-pulse' : 'bg-[var(--color-status-red)]'}`}
              />
              {isWorkerOk ? 'Worker 运行中' : 'Worker 异常'}
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
            实时监控 JSReverser Worker 状态、浏览器实例与调用链路。
          </p>
        </div>

        <button
          onClick={() => fetchStatus(true)}
          disabled={refreshing}
          className="self-start sm:self-center px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw
            size={12}
            className={refreshing ? 'animate-spin' : ''}
          />
          {refreshing ? '刷新中' : '手动刷新'}
        </button>
      </div>

      {/* 核心指标卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Worker 状态卡片 */}
        <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25 flex flex-col justify-between hover:border-[var(--color-accent)]/30 transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full filter blur-xl translate-x-8 -translate-y-8 group-hover:bg-blue-500/10 transition-all duration-300" />
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-[var(--color-text-muted)] font-medium">
                Worker 节点
              </span>
              <Cpu
                className="text-[var(--color-accent)]"
                size={18}
              />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  版本号
                </span>
                <span className="font-mono text-[var(--color-text-primary)] bg-[var(--color-bg-primary)] px-2 py-0.5 rounded border border-[var(--color-border-muted)]">
                  v{status?.version}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  RPC Host
                </span>
                <span
                  className="font-mono text-[var(--color-text-primary)] truncate max-w-[140px]"
                  title={status?.rpcHost}
                >
                  {status?.rpcHost}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  Seciro Group
                </span>
                <span className="font-mono text-[var(--color-text-primary)] text-right">
                  {status?.group}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  进程 PID
                </span>
                <span className="font-mono text-[var(--color-text-primary)]">
                  {status?.pid}
                </span>
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--color-border-muted)] pt-4 mt-4 flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-secondary)] flex items-center gap-1.5">
              <Clock size={12} />
              运行时长
            </span>
            <span className="font-mono font-medium text-[var(--color-accent)]">
              {status ? formatUptime(status.uptime) : '--:--:--'}
            </span>
          </div>
        </div>

        {/* Browser CDP 状态 */}
        <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25 flex flex-col justify-between hover:border-[var(--color-accent)]/30 transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full filter blur-xl translate-x-8 -translate-y-8 group-hover:bg-emerald-500/10 transition-all duration-300" />
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-[var(--color-text-muted)] font-medium">
                CDP 浏览器
              </span>
              <Globe
                className={
                  isBrowserConnected
                    ? 'text-[var(--color-status-green)]'
                    : 'text-[var(--color-text-muted)]'
                }
                size={18}
              />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  连接状态
                </span>
                <span
                  className={`font-medium ${isBrowserConnected ? 'text-[var(--color-status-green)]' : 'text-[var(--color-status-red)]'}`}
                >
                  {isBrowserConnected ? '已连接' : '未连接'}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  运行模式
                </span>
                <span className="font-mono text-[var(--color-text-primary)]">
                  {status?.browser?.mode || 'CDP'}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  当前打开页面
                </span>
                <span className="font-mono text-[var(--color-text-primary)] font-semibold">
                  {status?.browser?.pages ?? 0} 个
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  会话 (Sessions)
                </span>
                <span className="font-mono text-[var(--color-text-primary)]">
                  {status?.browser?.sessions ?? 0} 个
                </span>
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--color-border-muted)] pt-4 mt-4 flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-secondary)] flex items-center gap-1.5">
              <Layers size={12} />
              调试器挂载
            </span>
            <span
              className={`font-mono font-medium ${isBrowserConnected ? 'text-[var(--color-status-green)]' : 'text-[var(--color-text-muted)]'}`}
            >
              {isBrowserConnected ? 'CDP Session Active' : 'Idle'}
            </span>
          </div>
        </div>

        {/* Hooks & Tools 统计 */}
        <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25 flex flex-col justify-between hover:border-[var(--color-accent)]/30 transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full filter blur-xl translate-x-8 -translate-y-8 group-hover:bg-purple-500/10 transition-all duration-300" />
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-[var(--color-text-muted)] font-medium">
                资源统计
              </span>
              <Wrench
                className="text-purple-400"
                size={18}
              />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  注册的工具数量
                </span>
                <span className="font-mono text-[var(--color-text-primary)] font-semibold">
                  {status?.tools?.total ?? 0}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  Hook 监控点总数
                </span>
                <span className="font-mono text-[var(--color-text-primary)]">
                  {status?.hooks?.total ?? 0} 个
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  处于活动 Hook
                </span>
                <span className="font-mono text-[var(--color-status-green)]">
                  {status?.hooks?.active ?? 0} 个
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  暂停的 Hook
                </span>
                <span className="font-mono text-[var(--color-text-muted)]">
                  {status?.hooks?.paused ?? 0} 个
                </span>
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--color-border-muted)] pt-4 mt-4 flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-secondary)] flex items-center gap-1.5">
              <Shield size={12} />
              安全防护盾
            </span>
            <span className="font-mono text-[var(--color-status-green)]">
              Enabled
            </span>
          </div>
        </div>
      </div>

      {/* 实时状态监听与历史集成 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2">
          <RecentInvocations />
        </div>
        <div className="xl:col-span-1">
          {/* 报错日志流监控面板 */}
          <div className="bg-black/90 border border-red-500/20 rounded-xl p-6 shadow-lg shadow-black/40 font-mono space-y-4">
            <div className="flex items-center justify-between border-b border-red-500/20 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                </div>
                <span className="text-xs font-semibold text-red-400 ml-2">
                  报错日志实时监控
                </span>
              </div>
              <span className="text-[10px] text-red-500/60 font-mono">
                LIVE MONITORING
              </span>
            </div>

            <div className="overflow-y-auto max-h-[350px] text-[11px] space-y-2 select-text scrollbar-thin scrollbar-thumb-zinc-800">
              {errorLogs.length === 0 ? (
                <p className="text-zinc-500 italic text-center py-12">
                  暂无捕获到的错误日志。
                </p>
              ) : (
                errorLogs.map(log => (
                  <div
                    key={log.id}
                    className="flex items-start gap-1.5 leading-relaxed hover:bg-white/5 p-1 rounded transition-colors"
                  >
                    <span className="text-emerald-500 shrink-0 select-none">
                      &gt;
                    </span>
                    <span className="text-zinc-500 shrink-0 font-medium select-none">
                      [{log.time}]
                    </span>
                    <span className="text-yellow-400 shrink-0 font-semibold">
                      {log.tool}:
                    </span>
                    <span className="text-red-400 break-all">
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
