import { useState } from 'react';
import {
  Terminal,
  CheckCircle,
  XCircle,
  Clock,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
} from 'lucide-react';
import { useInvocationsStore } from '../../stores/invocations';
import type { InvocationRecord } from '../../lib/protocol';

interface RecentInvocationsProps {
  records?: InvocationRecord[];
}

export function RecentInvocations({ records: propRecords }: RecentInvocationsProps) {
  const storeRecords = useInvocationsStore((state) => state.records);
  const records = propRecords !== undefined ? propRecords : storeRecords;

  // 记录折叠状态，key 为 record.id
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 复制反馈状态，key 为复制的内容标识
  const [copyFeedback, setCopyFeedback] = useState<Record<string, boolean>>({});

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setCopyFeedback((prev) => ({ ...prev, [key]: false }));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString() + ' ' + date.toLocaleDateString();
    } catch {
      return isoString;
    }
  };

  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25 space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-4">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-[var(--color-accent)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">最近工具调用历史</h3>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-secondary)]">
          活跃记录: {records.length}
        </span>
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-[var(--color-border-default)] rounded-lg bg-[var(--color-bg-primary)]/50">
          <div className="w-8 h-8 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] flex items-center justify-center mb-3">
            <Cpu size={14} className="text-[var(--color-text-muted)]" />
          </div>
          <p className="text-xs text-[var(--color-text-muted)] text-center max-w-[260px]">
            暂无工具调用记录。当您调用 RPC 工具时，记录将实时显示在此处。
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-border-muted)] overflow-hidden rounded-lg border border-[var(--color-border-default)]">
          {records.map((record) => {
            const isExpanded = expandedId === record.id;
            const hasArgs = !!record.args && Object.keys(record.args).length > 0;
            const hasResult = record.result !== undefined && record.result !== null;
            const hasError = !!record.error;

            return (
              <div
                key={record.id}
                className="bg-[var(--color-bg-secondary)]/50 hover:bg-[var(--color-bg-secondary)]/80 transition-colors"
              >
                {/* 列表头部条目 */}
                <div
                  onClick={() => toggleExpand(record.id)}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {record.success ? (
                      <CheckCircle size={16} className="text-[var(--color-status-green)] shrink-0" />
                    ) : (
                      <XCircle size={16} className="text-[var(--color-status-red)] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-[var(--color-text-primary)] font-mono truncate max-w-[180px]">
                          {record.toolName}
                        </span>
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${
                            record.success
                              ? 'bg-emerald-500/10 text-[var(--color-status-green)] border-emerald-500/20'
                              : 'bg-red-500/10 text-[var(--color-status-red)] border-red-500/20'
                          }`}
                        >
                          {record.success ? 'Success' : 'Failed'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)] mt-1 font-mono">
                        <span className="truncate max-w-[120px] sm:max-w-[200px]" title={record.traceId}>
                          Trace: {record.traceId}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(record.traceId, `trace_${record.id}`);
                          }}
                          className="hover:text-[var(--color-text-primary)] transition-colors p-0.5"
                          title="复制 Trace ID"
                        >
                          {copyFeedback[`trace_${record.id}`] ? (
                            <Check size={10} className="text-[var(--color-status-green)]" />
                          ) : (
                            <Copy size={10} />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 text-xs font-mono text-[var(--color-text-secondary)]">
                    <div className="flex items-center gap-1">
                      <Clock size={11} className="text-[var(--color-text-muted)]" />
                      <span>{record.durationMs.toFixed(0)} ms</span>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-muted)] text-right">
                      {formatTime(record.startedAt)}
                    </span>
                    <div className="text-[var(--color-text-muted)] hidden sm:block">
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                </div>

                {/* 展开部分 */}
                {isExpanded && (
                  <div className="p-4 border-t border-[var(--color-border-muted)] bg-[var(--color-bg-primary)]/40 space-y-4 animate-[fadeIn_0.2s_ease-out]">
                    {/* 参数 */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--color-text-secondary)]">
                        <span>输入参数 (Arguments)</span>
                        {hasArgs && (
                          <button
                            onClick={() =>
                              handleCopy(
                                JSON.stringify(record.args, null, 2),
                                `args_${record.id}`,
                              )
                            }
                            className="flex items-center gap-1 text-[10px] hover:text-[var(--color-text-primary)] transition-colors"
                          >
                            {copyFeedback[`args_${record.id}`] ? (
                              <>
                                <Check size={10} className="text-[var(--color-status-green)]" />
                                <span className="text-[var(--color-status-green)]">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy size={10} />
                                <span>复制参数</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <pre className="font-mono bg-[var(--color-bg-primary)] p-3 rounded-lg border border-[var(--color-border-default)] text-xs text-[var(--color-text-primary)] overflow-auto max-h-48 select-text">
                        {hasArgs ? JSON.stringify(record.args, null, 2) : '{}'}
                      </pre>
                    </div>

                    {/* 结果或报错 */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--color-text-secondary)]">
                        <span>{record.success ? '输出结果 (Result)' : '报错详情 (Error)'}</span>
                        {(hasResult || hasError) && (
                          <button
                            onClick={() =>
                              handleCopy(
                                record.success
                                  ? JSON.stringify(record.result, null, 2)
                                  : JSON.stringify(record.error, null, 2),
                                `res_${record.id}`,
                              )
                            }
                            className="flex items-center gap-1 text-[10px] hover:text-[var(--color-text-primary)] transition-colors"
                          >
                            {copyFeedback[`res_${record.id}`] ? (
                              <>
                                <Check size={10} className="text-[var(--color-status-green)]" />
                                <span className="text-[var(--color-status-green)]">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy size={10} />
                                <span>复制结果</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      {record.success ? (
                        <pre className="font-mono bg-[var(--color-bg-primary)] p-3 rounded-lg border border-[var(--color-border-default)] text-xs text-emerald-400 overflow-auto max-h-60 select-text">
                          {hasResult ? JSON.stringify(record.result, null, 2) : 'null'}
                        </pre>
                      ) : (
                        <div className="bg-red-500/5 border border-red-500/20 p-3 rounded-lg text-red-400 font-mono text-xs space-y-2">
                          <p className="bg-[var(--color-bg-primary)] p-2 rounded border border-red-500/10 select-text overflow-auto max-h-40">
                            {record.error?.message || '未知 RPC 错误'}
                          </p>
                          {record.error?.code && (
                            <div className="text-[10px] opacity-80 border-t border-red-500/10 pt-2">
                              Error Code: {record.error.code}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
