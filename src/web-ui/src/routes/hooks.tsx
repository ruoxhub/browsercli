/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Activity,
  Trash2,
  Plus,
  Terminal,
  Settings,
  ChevronDown,
  ChevronUp,
  Search,
  Code,
  Sparkles,
  X,
  Keyboard,
  Info,
  CornerDownRight,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import {useState, useEffect, useRef} from 'react';

import {api} from '../lib/api';
import type {HookSampleEvent} from '../lib/protocol';
import {wsClient} from '../lib/ws';

interface ActiveHook {
  hookId: string;
  target: string;
  logArgs: boolean;
  logResult: boolean;
  logStack: boolean;
}

interface CommandItem {
  id: string;
  name: string;
  desc: string;
  category: string;
  action: () => void;
}

export default function HooksPage() {
  const [hooks, setHooks] = useState<ActiveHook[]>([]);
  const [selectedHookId, setSelectedHookId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 新建 Hook 表单状态
  const [target, setTarget] = useState('');
  const [logArgs, setLogArgs] = useState(true);
  const [logResult, setLogResult] = useState(true);
  const [logStack, setLogStack] = useState(true);
  const [customHookId, setCustomHookId] = useState('');

  // 采样事件流
  const [samples, setSamples] = useState<HookSampleEvent[]>([]);

  // 命令面板 (Command Palette) 状态
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  // 弹窗与控制台输出折叠
  const [expandedSamples, setExpandedSamples] = useState<
    Record<number, boolean>
  >({});

  // 获取 Hook 列表
  const fetchHooks = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getHooks();
      // 后端 list_hooks 返回结构通常包含 hooks 数组，或者是直接是一个列表
      const hooksList = Array.isArray(response)
        ? response
        : response?.hooks || response?.data || [];

      setHooks(hooksList);

      if (hooksList.length > 0) {
        // 如果当前没有选中或者选中的不在列表中，选中第一个
        if (
          !selectedHookId ||
          !hooksList.find((h: any) => (h.hookId || h.id) === selectedHookId)
        ) {
          setSelectedHookId(hooksList[0].hookId || hooksList[0].id);
        }
      } else {
        setSelectedHookId('');
      }
    } catch (err) {
      console.error('Failed to fetch hooks:', err);
      setError(err instanceof Error ? err.message : '获取 Hook 列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchHooks();
  }, []);

  // 监听选中的 Hook ID，订阅 WS 频道
  useEffect(() => {
    if (!selectedHookId) {
      setSamples([]);
      return;
    }

    // 订阅时指定过滤条件：
    const unsubscribe = wsClient.subscribe(
      'hook.sample',
      msg => {
        const payload = msg.payload as HookSampleEvent;
        // 实时接收新采样事件，按时间倒序排列并仅保留前 100 条
        setSamples(prev => {
          // 防重
          if (prev.some(s => s.seq === payload.seq && s.ts === payload.ts)) {
            return prev;
          }
          return [payload, ...prev].slice(0, 100);
        });
      },
      {hookId: selectedHookId},
    );

    return () => {
      unsubscribe();
    };
  }, [selectedHookId]);

  // 新建 Hook 注入
  const handleCreateHook = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!target.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const args = {
        target: target.trim(),
        logArgs,
        logResult,
        logStack,
        hookId: customHookId.trim() || undefined,
      };

      await api.createHook(args);
      setTarget('');
      setCustomHookId('');

      // 刷新列表
      await fetchHooks();
    } catch (err) {
      console.error('Failed to create hook:', err);
      setError(err instanceof Error ? err.message : '注入 Hook 失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 卸载 Hook
  const handleDeleteHook = async (hookId: string) => {
    setError(null);
    try {
      await api.deleteHook(hookId);
      // 在列表中实时剔除
      setHooks(prev =>
        prev.filter(h => (h.hookId || (h as any).id) !== hookId),
      );
      if (selectedHookId === hookId) {
        setSelectedHookId('');
        setSamples([]);
      }
    } catch (err) {
      console.error('Failed to delete hook:', err);
      setError(err instanceof Error ? err.message : '注销 Hook 失败');
    }
  };

  // 命令面板可选命令定义
  const commandList: CommandItem[] = [
    {
      id: 'hook_fetch',
      name: '注入 fetch Hook',
      desc: '自动拦截 window.fetch 异步网关请求',
      category: '快速逆向注入',
      action: () => {
        setTarget('fetch');
        setLogArgs(true);
        setLogResult(true);
        setLogStack(true);
      },
    },
    {
      id: 'hook_xhr',
      name: '注入 XHR Hook',
      desc: '拦截 XMLHttpRequest.prototype.open 方法',
      category: '快速逆向注入',
      action: () => {
        setTarget('XMLHttpRequest.prototype.open');
        setLogArgs(true);
        setLogResult(true);
        setLogStack(true);
      },
    },
    {
      id: 'hook_json',
      name: '注入 JSON.parse Hook',
      desc: '捕获所有从 String 反序列化为 Object 的堆栈',
      category: '快速逆向注入',
      action: () => {
        setTarget('JSON.parse');
        setLogArgs(true);
        setLogResult(true);
        setLogStack(true);
      },
    },
    {
      id: 'hook_canvas',
      name: '注入 Canvas 噪音防跟踪检测 Hook',
      desc: '拦截 HTMLCanvasElement.prototype.toDataURL 行为',
      category: '快速逆向注入',
      action: () => {
        setTarget('HTMLCanvasElement.prototype.toDataURL');
        setLogArgs(true);
        setLogResult(true);
        setLogStack(true);
      },
    },
    {
      id: 'toggle_all_on',
      name: '启用所有捕获属性开关',
      desc: '一键启用参数 (Args)、返回值 (Result)、堆栈 (Stack) 追踪',
      category: '面板控制',
      action: () => {
        setLogArgs(true);
        setLogResult(true);
        setLogStack(true);
      },
    },
    {
      id: 'clear_samples',
      name: '清空当前页面采样记录流',
      desc: '擦除屏幕中已接收的实时 Hook 数据包',
      category: '面板控制',
      action: () => {
        setSamples([]);
      },
    },
    {
      id: 'refresh_list',
      name: '刷新 Hook 容器列表',
      desc: '主动向底层 RPC 发起同步请求更新 Hook 表',
      category: '系统通信',
      action: () => {
        void fetchHooks();
      },
    },
    {
      id: 'delete_current',
      name: '卸载当前选中的拦截点',
      desc: '立刻销毁当前高亮状态的 Hook 点',
      category: '系统通信',
      action: () => {
        if (selectedHookId) {
          void handleDeleteHook(selectedHookId);
        }
      },
    },
  ];

  // 过滤命令列表
  const filteredCommands = commandList.filter(
    cmd =>
      cmd.name.toLowerCase().includes(paletteQuery.toLowerCase()) ||
      cmd.desc.toLowerCase().includes(paletteQuery.toLowerCase()) ||
      cmd.category.toLowerCase().includes(paletteQuery.toLowerCase()),
  );

  // 注册快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
        setPaletteQuery('');
        setPaletteIndex(0);
        return;
      }

      // . or /
      if (e.key === '.' || e.key === '/') {
        const activeEl = document.activeElement;
        const isEditing =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            (activeEl as HTMLElement).isContentEditable);
        if (!isEditing) {
          e.preventDefault();
          setPaletteOpen(true);
          setPaletteQuery('');
          setPaletteIndex(0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 当命令面板打开时，自动聚焦输入框
  useEffect(() => {
    if (paletteOpen) {
      setTimeout(() => {
        paletteInputRef.current?.focus();
      }, 50);
    }
  }, [paletteOpen]);

  // 命令面板快捷键导航
  const handlePaletteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setPaletteOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPaletteIndex(
        prev => (prev + 1) % Math.max(1, filteredCommands.length),
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPaletteIndex(prev =>
        prev === 0 ? filteredCommands.length - 1 : prev - 1,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[paletteIndex]) {
        filteredCommands[paletteIndex].action();
        setPaletteOpen(false);
      }
    }
  };

  const toggleSampleExpand = (seq: number) => {
    setExpandedSamples(prev => ({
      ...prev,
      [seq]: !prev[seq],
    }));
  };

  // 格式化展示复杂值
  const formatValue = (val: any) => {
    if (val === undefined) return 'undefined';
    if (val === null) return 'null';
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val, null, 2);
      } catch {
        return '[Object]';
      }
    }
    return String(val);
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden select-none bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* 左侧栏 - 活跃 Hook 列表 */}
      <div className="w-full md:w-80 border-r border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/30 backdrop-blur-md flex flex-col h-2/5 md:h-full overflow-hidden">
        {/* 顶部标题与信息 */}
        <div className="p-4 border-b border-[var(--color-border-muted)] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wider text-[var(--color-text-primary)] flex items-center gap-2">
              <Activity
                size={14}
                className="text-[var(--color-accent)] animate-pulse"
              />
              注入的 Hook 拦截点
            </h2>
            <button
              onClick={fetchHooks}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-all duration-150"
              title="重新加载"
            >
              <RefreshCw
                size={12}
                className={loading ? 'animate-spin' : ''}
              />
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] bg-[var(--color-bg-primary)]/80 px-2 py-1.5 rounded-lg border border-[var(--color-border-default)]/60">
            <Keyboard
              size={12}
              className="text-[var(--color-accent)]"
            />
            <span>
              按{' '}
              <kbd className="bg-[var(--color-bg-tertiary)] px-1 rounded font-mono border border-[var(--color-border-default)] text-[9px] font-bold">
                Ctrl+K
              </kbd>{' '}
              或{' '}
              <kbd className="bg-[var(--color-bg-tertiary)] px-1 rounded font-mono border border-[var(--color-border-default)] text-[9px] font-bold">
                .
              </kbd>{' '}
              唤醒终端
            </span>
          </div>
        </div>

        {/* 活跃列表区 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {loading && hooks.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--color-text-muted)]">
              加载 Hook 列表中...
            </div>
          ) : hooks.length === 0 ? (
            <div className="py-12 text-center px-4 space-y-2">
              <div className="w-8 h-8 rounded-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]/50 flex items-center justify-center mx-auto text-[var(--color-text-muted)]">
                <Code size={14} />
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] font-medium">
                暂无活跃 Hook 拦截点
              </p>
              <p className="text-[10px] text-[var(--color-text-muted)] max-w-[180px] mx-auto leading-relaxed">
                请在右侧新建面板中录入 Target 表达式并完成注入。
              </p>
            </div>
          ) : (
            hooks.map(item => {
              const hookId = item.hookId || (item as any).id;
              const isSelected = selectedHookId === hookId;
              return (
                <div
                  key={hookId}
                  onClick={() => setSelectedHookId(hookId)}
                  className={`group relative flex items-center justify-between p-3 rounded-lg border text-left cursor-pointer transition-all duration-200 ${
                    isSelected
                      ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/60 shadow-sm shadow-[var(--color-accent)]/5'
                      : 'bg-[var(--color-bg-primary)]/40 border-[var(--color-border-default)] hover:bg-[var(--color-bg-primary)]/80 hover:border-[var(--color-border-default)]/80'
                  }`}
                >
                  <div className="space-y-1 flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-[var(--color-accent)]' : 'bg-emerald-500'} animate-ping`}
                      />
                      <span className="text-xs font-mono font-bold truncate text-[var(--color-text-primary)]">
                        {item.target}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-[var(--color-text-muted)] flex items-center gap-2">
                      <span>ID: {hookId}</span>
                    </div>
                    {/* 勾选的监控项微标 */}
                    <div className="flex items-center gap-1.5 pt-1">
                      {item.logArgs && (
                        <span className="text-[8px] px-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-mono scale-95 origin-left">
                          Args
                        </span>
                      )}
                      {item.logResult && (
                        <span className="text-[8px] px-1 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 font-mono scale-95 origin-left">
                          Ret
                        </span>
                      )}
                      {item.logStack && (
                        <span className="text-[8px] px-1 rounded bg-purple-500/10 text-purple-500 border border-purple-500/20 font-mono scale-95 origin-left">
                          Stack
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      void handleDeleteHook(hookId);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-500/15 hover:text-red-500 text-[var(--color-text-muted)] transition-all duration-150"
                    title="卸载此 Hook"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 右侧主工作区 */}
      <div className="flex-1 flex flex-col h-3/5 md:h-full overflow-hidden">
        {/* Hook 注入面板与错误条 */}
        <div className="p-4 border-b border-[var(--color-border-default)] space-y-3 bg-[var(--color-bg-secondary)]/10">
          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs animate-shake">
              <ShieldAlert
                size={14}
                className="flex-shrink-0 mt-0.5"
              />
              <div className="flex-1">
                <span className="font-semibold">操作异常: </span>
                {error}
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-500/60 hover:text-red-500"
              >
                <X size={12} />
              </button>
            </div>
          )}

          <div className="flex flex-col xl:flex-row gap-4">
            {/* 新建面板 */}
            <div className="flex-1 space-y-3">
              <h3 className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                <Settings
                  size={12}
                  className="text-[var(--color-accent)]"
                />
                逆向 Hook 安装器
              </h3>

              <form
                onSubmit={handleCreateHook}
                className="flex flex-col md:flex-row gap-3"
              >
                <div className="flex-1 flex flex-col md:flex-row gap-3">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      placeholder="Target 拦截对象 (例如: fetch, JSON.parse)"
                      value={target}
                      onChange={e => setTarget(e.target.value)}
                      className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all font-mono"
                      required
                    />
                  </div>

                  <div className="w-full md:w-44">
                    <input
                      type="text"
                      placeholder="自定义 Hook ID (选填)"
                      value={customHookId}
                      onChange={e => setCustomHookId(e.target.value)}
                      className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/20 transition-all font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !target.trim()}
                  className="bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/90 text-white font-medium text-xs px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm shadow-[var(--color-accent)]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  <span>注入 Hook</span>
                </button>
              </form>
            </div>

            {/* 开关设置 */}
            <div className="flex flex-row flex-wrap items-center gap-4 bg-[var(--color-bg-primary)]/40 p-2.5 rounded-lg border border-[var(--color-border-default)]/60">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={logArgs}
                  onChange={e => setLogArgs(e.target.checked)}
                  className="rounded border-[var(--color-border-default)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30 bg-[var(--color-bg-primary)] w-3.5 h-3.5"
                />
                <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                  捕获参数 (Args)
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={logResult}
                  onChange={e => setLogResult(e.target.checked)}
                  className="rounded border-[var(--color-border-default)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30 bg-[var(--color-bg-primary)] w-3.5 h-3.5"
                />
                <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                  捕获返回值 (Result)
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={logStack}
                  onChange={e => setLogStack(e.target.checked)}
                  className="rounded border-[var(--color-border-default)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30 bg-[var(--color-bg-primary)] w-3.5 h-3.5"
                />
                <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                  捕获调用栈 (Stack)
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* 采样记录流主体部分 */}
        <div className="flex-1 flex flex-col min-h-0 bg-[var(--color-bg-primary)]">
          <div className="px-4 py-2 border-b border-[var(--color-border-default)] flex items-center justify-between bg-[var(--color-bg-secondary)]/10">
            <div className="flex items-center gap-2">
              <Terminal
                size={14}
                className="text-[var(--color-text-secondary)]"
              />
              <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                Hook 实时采样流
              </span>
            </div>
            {selectedHookId && (
              <span className="text-[10px] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] px-2 py-0.5 rounded-full font-mono font-medium">
                当前信道: {selectedHookId.slice(0, 12)}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs">
            {!selectedHookId ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                <div className="w-10 h-10 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-muted)] animate-pulse">
                  <Activity size={18} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-[var(--color-text-secondary)] font-semibold">
                    请选择一个活跃 Hook 进行采样监听
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)] max-w-sm leading-relaxed">
                    选择左侧列表中的拦截点后，当浏览器执行到目标函数时，此处会实时输出捕获的参数、返回值以及逆向堆栈镜像。
                  </p>
                </div>
              </div>
            ) : samples.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                <div className="w-10 h-10 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-accent)] animate-bounce">
                  <Sparkles size={18} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-[var(--color-text-secondary)] font-semibold">
                    等待拦截事件上报...
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)] max-w-xs leading-relaxed">
                    WebSocket 信道正常。请在目标页面触发被 Hook 函数的调用。
                  </p>
                </div>
              </div>
            ) : (
              samples.map(sample => {
                const isExpanded = !!expandedSamples[sample.seq];
                const dateStr = new Date(sample.ts).toLocaleTimeString();

                return (
                  <div
                    key={`${sample.seq}-${sample.ts}`}
                    className="p-3 bg-[var(--color-bg-secondary)]/50 border border-[var(--color-border-default)] rounded-xl space-y-2 hover:border-[var(--color-border-default)]/90 transition-all duration-200"
                  >
                    {/* 首部条 */}
                    <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-[var(--color-bg-tertiary)] text-[var(--color-accent)] px-2 py-0.5 rounded border border-[var(--color-border-default)] font-bold">
                          #{sample.seq}
                        </span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {dateStr}
                        </span>
                      </div>

                      {sample.truncated && (
                        <span className="text-[9px] text-amber-500 bg-amber-500/10 px-1.5 rounded border border-amber-500/20">
                          Data Truncated
                        </span>
                      )}
                    </div>

                    {/* 参数 (Arguments) */}
                    {sample.args && sample.args.length > 0 ? (
                      <div className="space-y-1">
                        <div className="text-[10px] text-[var(--color-text-secondary)] font-bold uppercase tracking-wider flex items-center gap-1">
                          <CornerDownRight
                            size={10}
                            className="text-[var(--color-accent)]"
                          />
                          Arguments ({sample.args.length})
                        </div>
                        <pre className="p-2.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)]/60 rounded-lg overflow-x-auto text-[11px] text-[var(--color-text-primary)] max-h-40 leading-relaxed font-mono">
                          {sample.args.map((arg, idx) => (
                            <div
                              key={idx}
                              className="border-b border-[var(--color-border-muted)]/20 last:border-0 pb-1 mb-1 last:pb-0 last:mb-0"
                            >
                              <span className="text-[var(--color-text-muted)]">
                                [{idx}]:{' '}
                              </span>
                              {formatValue(arg)}
                            </div>
                          ))}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-[10px] text-[var(--color-text-muted)] italic flex items-center gap-1">
                        <CornerDownRight size={10} />
                        No arguments captured
                      </div>
                    )}

                    {/* 返回值 (Return Value) */}
                    {'retVal' in sample ? (
                      <div className="space-y-1">
                        <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1">
                          <CornerDownRight
                            size={10}
                            className="text-blue-400"
                          />
                          Return Value
                        </div>
                        <pre className="p-2.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)]/60 rounded-lg overflow-x-auto text-[11px] text-blue-300 max-h-40 leading-relaxed font-mono">
                          {formatValue(sample.retVal)}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-[10px] text-[var(--color-text-muted)] italic flex items-center gap-1">
                        <CornerDownRight size={10} />
                        No return value captured
                      </div>
                    )}

                    {/* 调用堆栈 */}
                    {sample.stack && sample.stack.length > 0 && (
                      <div className="pt-1.5 border-t border-[var(--color-border-muted)]/30">
                        <button
                          onClick={() => toggleSampleExpand(sample.seq)}
                          className="flex items-center gap-1 text-[10px] font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors duration-150 uppercase tracking-wider"
                        >
                          {isExpanded ? (
                            <ChevronUp size={10} />
                          ) : (
                            <ChevronDown size={10} />
                          )}
                          <span>
                            Stack Trace ({sample.stack.length} frames)
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="mt-2 pl-3 border-l-2 border-[var(--color-accent)]/30 space-y-1">
                            {sample.stack.map((frame, idx) => (
                              <div
                                key={idx}
                                className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] hover:bg-[var(--color-bg-primary)]/50 p-1 rounded transition-colors duration-100"
                              >
                                <span className="text-[var(--color-text-primary)] font-semibold truncate max-w-xs">
                                  at {frame.functionName || '(anonymous)'}
                                </span>
                                <span
                                  className="text-[10px] text-[var(--color-text-muted)] font-mono hover:text-[var(--color-accent)] cursor-help truncate max-w-sm select-text"
                                  title={`${frame.url}:${frame.line}:${frame.col}`}
                                >
                                  {frame.url.split('/').pop() || 'vm'}:
                                  {frame.line}:{frame.col}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 极客终端命令面板 (Command Palette Modal) */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div
            className="w-full max-w-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl shadow-2xl overflow-hidden animate-slideDown"
            onKeyDown={handlePaletteKeyDown}
          >
            {/* 头部搜索栏 */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-default)]">
              <Search
                size={16}
                className="text-[var(--color-text-muted)]"
              />
              <input
                ref={paletteInputRef}
                type="text"
                placeholder="搜索逆向功能或快速指令..."
                value={paletteQuery}
                onChange={e => {
                  setPaletteQuery(e.target.value);
                  setPaletteIndex(0);
                }}
                className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none"
              />
              <button
                onClick={() => setPaletteOpen(false)}
                className="p-1 rounded-md hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                <X size={14} />
              </button>
            </div>

            {/* 功能列表 */}
            <div className="max-h-60 overflow-y-auto p-2">
              {filteredCommands.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
                  没有匹配的逆向操作指令
                </div>
              ) : (
                filteredCommands.map((cmd, idx) => {
                  const isSelected = idx === paletteIndex;
                  return (
                    <div
                      key={cmd.id}
                      onClick={() => {
                        cmd.action();
                        setPaletteOpen(false);
                      }}
                      className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all duration-150 ${
                        isSelected
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold flex items-center gap-1.5">
                          {cmd.name}
                          <span
                            className={`text-[8px] px-1 rounded uppercase font-mono ${
                              isSelected
                                ? 'bg-white/20 text-white border border-white/20'
                                : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] border border-[var(--color-border-default)]'
                            }`}
                          >
                            {cmd.category}
                          </span>
                        </div>
                        <div
                          className={`text-[10px] ${isSelected ? 'text-white/80' : 'text-[var(--color-text-muted)]'}`}
                        >
                          {cmd.desc}
                        </div>
                      </div>

                      {isSelected && (
                        <kbd className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-mono">
                          Enter
                        </kbd>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* 尾部帮助提示 */}
            <div className="bg-[var(--color-bg-tertiary)] px-4 py-2 border-t border-[var(--color-border-default)] flex justify-between items-center text-[10px] text-[var(--color-text-muted)]">
              <span className="flex items-center gap-1">
                <Info size={10} />
                <span>
                  使用方向键 <kbd>↑</kbd> <kbd>↓</kbd> 切换，<kbd>Enter</kbd>{' '}
                  触发，<kbd>Esc</kbd> 退出
                </span>
              </span>
              <span>JSReverser Terminal</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
