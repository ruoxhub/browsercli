/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Download, FileText, RefreshCw, Sparkles} from 'lucide-react';
import React from 'react';

import {api} from '../lib/api';
import type {SessionAnalysisMode} from '../lib/protocol';
import {useAnalysisStore} from '../stores/analysis';

const MODES: Array<{value: SessionAnalysisMode; label: string}> = [
  {value: 'auto', label: '自动检测'},
  {value: 'api_reverse', label: '接口逆向'},
  {value: 'security', label: '安全审查'},
  {value: 'perf', label: '性能分析'},
  {value: 'js_crypto', label: 'JS 加密'},
];

/**
 * 极简 Markdown 渲染：不引入额外依赖，按标题 / 列表 / 代码块 / 粗体做基础渲染。
 * AI 报告由系统提示词控制为结构化 markdown，这里只做够用的展示。
 */
function renderMarkdown(markdown: string): React.ReactNode[] {
  const lines = markdown.split('\n');
  const nodes: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ul
        key={nodes.length}
        className="space-y-1 my-2 pl-4"
      >
        {listBuffer.map((item, i) => (
          <li
            key={i}
            className="text-xs text-[var(--color-text-secondary)] leading-relaxed list-disc"
          >
            {renderInline(item)}
          </li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  const flushCode = () => {
    nodes.push(
      <pre
        key={nodes.length}
        className="my-3 p-3 rounded-lg bg-black/40 border border-[var(--color-border-default)] text-[11px] font-mono text-[var(--color-text-primary)] overflow-x-auto"
      >
        {codeLines.join('\n')}
      </pre>,
    );
    codeLines = [];
  };

  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCode();
      } else {
        flushList();
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushList();
      listBuffer.push(line.replace(/^\s*[-*]\s+/, ''));
      continue;
    }
    flushList();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const cls =
        level <= 1
          ? 'text-lg font-bold mt-5 mb-2'
          : level <= 2
            ? 'text-base font-semibold mt-4 mb-1.5'
            : 'text-sm font-semibold mt-3 mb-1';
      nodes.push(
        <div
          key={nodes.length}
          className={`${cls} text-[var(--color-text-primary)]`}
        >
          {renderInline(text)}
        </div>,
      );
      continue;
    }
    if (line.trim() === '') {
      continue;
    }
    nodes.push(
      <p
        key={nodes.length}
        className="text-xs text-[var(--color-text-secondary)] leading-relaxed my-1 break-words"
      >
        {renderInline(line)}
      </p>,
    );
  }
  if (inCodeBlock) flushCode();
  else flushList();
  return nodes;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong
          key={i}
          className="font-semibold text-[var(--color-text-primary)]"
        >
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="px-1 py-0.5 rounded bg-black/40 text-[11px] font-mono text-[var(--color-accent)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

const ReportView: React.FC = () => {
  const analysisMode = useAnalysisStore(state => state.mode);
  const setAnalysisMode = useAnalysisStore(state => state.setMode);
  const report = useAnalysisStore(state => state.report);
  const setReport = useAnalysisStore(state => state.setReport);
  const analyzing = useAnalysisStore(state => state.analyzing);
  const setAnalyzing = useAnalysisStore(state => state.setAnalyzing);
  const error = useAnalysisStore(state => state.error);
  const setError = useAnalysisStore(state => state.setError);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await api.analyzeSession({mode: analysisMode});
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExport = () => {
    if (!report) return;
    const blob = new Blob([report.reportMarkdown], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto select-none">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-border-muted)] pb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
            AI 流量分析
          </h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
            对当前抓包会话的流量做场景识别与逆向分析。也可在「流量抓包」页勾选具体数据包后发起。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={analysisMode}
            onChange={e =>
              setAnalysisMode(e.target.value as SessionAnalysisMode)
            }
            disabled={analyzing}
            className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] text-xs font-mono text-[var(--color-text-primary)] rounded-lg px-3 py-2 focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          >
            {MODES.map(m => (
              <option
                key={m.value}
                value={m.value}
                className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              >
                {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] text-xs font-medium hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {analyzing ? (
              <RefreshCw
                size={14}
                className="animate-spin"
              />
            ) : (
              <Sparkles size={14} />
            )}
            {analyzing ? '分析中…' : report ? '重新分析' : '开始分析'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs text-[var(--color-status-red)]">
          {error}
        </div>
      )}

      {analyzing && !report && (
        <div className="mt-16 flex flex-col items-center justify-center text-center">
          <RefreshCw
            size={28}
            className="animate-spin text-[var(--color-accent)] mb-3"
          />
          <p className="text-xs text-[var(--color-text-secondary)]">
            正在对抓包流量做提纯与场景推断…
          </p>
        </div>
      )}

      {!report && !analyzing && (
        <div className="mt-16 flex flex-col items-center justify-center text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-muted)] mb-3">
            <FileText size={26} />
          </div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            暂无分析报告
          </p>
          <p className="text-xs text-[var(--color-text-muted)] max-w-xs leading-relaxed mt-1">
            点击右上角「开始分析」，让 AI
            解读当前抓包会话的关键接口、签名与加密逻辑。
          </p>
        </div>
      )}

      {report && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3 text-xs">
              <span className="px-2 py-0.5 rounded font-mono bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-secondary)]">
                {report.mode}
              </span>
              <span className="text-[var(--color-text-muted)]">
                {report.requestCount} 条请求 ·{' '}
                {report.llmUsed ? 'LLM 生成' : '离线降级报告'}
              </span>
            </div>
            <button
              onClick={handleExport}
              className="px-3 py-1.5 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-1.5"
            >
              <Download size={12} />
              导出 Markdown
            </button>
          </div>

          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25 select-text">
            <div className="max-w-3xl">
              {renderMarkdown(report.reportMarkdown)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportView;
