/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {LLMService} from '../../services/LLMService.js';
import {CryptoScriptExtractor} from '../analyzer/ai/CryptoScriptExtractor.js';
import {PromptBuilder} from '../analyzer/ai/PromptBuilder.js';
import {SceneDetector} from '../analyzer/ai/SceneDetector.js';
import {TrafficPurifier} from '../analyzer/ai/TrafficPurifier.js';
import type {AnalysisMode} from '../analyzer/ai/types.js';

import type {CaptureSessionManager} from './CaptureSessionManager.js';

/**
 * 一次 AI 分析的产物。reportId 仅在 persist 时存在。
 */
export interface SessionAnalysisResult {
  reportId: string | null;
  reportMarkdown: string;
  mode: AnalysisMode;
  llmUsed: boolean;
  requestCount: number;
}

export interface RunSessionAnalysisOptions {
  /** 会话 ID；缺省取当前活动会话（同各 session 工具语义）。 */
  sessionId?: string;
  /** 分析模式，默认 auto。 */
  mode?: AnalysisMode;
  /** 仅分析这些请求 id；缺省分析会话全部请求。 */
  requestIds?: string[];
  /** 是否把报告持久化到 ai_reports 表，默认 false。 */
  persist?: boolean;
  /** 供提纯与加密代码切片使用的服务集合。 */
  manager: CaptureSessionManager;
  llmService: LLMService;
  /** 依 url 取脚本正文（供 CryptoScriptExtractor 切片）。 */
  getFileByUrl?: (url: string) => {content: string} | null;
}

/**
 * 共享的「选择数据包 → AI 分析」编排：提纯请求 → 场景检测 → 构建提示词 →
 * (可选) LLM 生成 / 离线降级 → (可选) 持久化报告。
 *
 * requestIds 为「已选中」语义：传入后仅分析命中的请求，等价于
 * anything-analyzer 的「分析已选 N 条」；缺省走整会话全量。
 */
export async function runSessionAnalysis(
  options: RunSessionAnalysisOptions,
): Promise<SessionAnalysisResult> {
  const {manager} = options;

  let session;
  if (options.sessionId) {
    session = manager.getSession(options.sessionId);
    if (!session) {
      throw new Error(`No session found with id: ${options.sessionId}`);
    }
  } else {
    session = manager.requireActiveSession();
  }

  const selectedIds = options.requestIds;
  const idSet =
    selectedIds && selectedIds.length > 0 ? new Set(selectedIds) : null;

  let requests = manager.getRequests(session.id);
  if (idSet) {
    requests = requests.filter(r => idSet.has(r.id));
  }
  const hooks = manager.getHooks(session.id);

  const sceneHints = new SceneDetector().detect(requests, hooks);
  const purifiedRequests = new TrafficPurifier().purify(requests);
  const extractor = new CryptoScriptExtractor();
  const cryptoSnippets = extractor.extractSnippets(
    hooks,
    url => options.getFileByUrl?.(url)?.content ?? null,
  );

  const mode: AnalysisMode = options.mode ?? 'auto';
  const built = new PromptBuilder().buildPrompt({
    mode,
    sceneHints,
    purifiedRequests,
    cryptoSnippets,
    targetUrl: session.targetUrl,
  });

  const llm = options.llmService;
  let reportMarkdown: string;
  let llmUsed = false;
  try {
    if (llm.isConfigured()) {
      const res = await llm.chat([
        {role: 'system', content: built.systemPrompt},
        {role: 'user', content: built.userPrompt},
      ]);
      reportMarkdown = typeof res === 'string' ? res : res.content;
      llmUsed = true;
    } else {
      reportMarkdown = built.fallbackReport;
    }
  } catch {
    reportMarkdown = built.fallbackReport;
  }

  let reportId: string | null = null;
  if (options.persist) {
    reportId = manager.saveReport({
      sessionId: session.id,
      mode,
      sceneHints: JSON.stringify(sceneHints),
      purifiedSummary: JSON.stringify({count: purifiedRequests.length}),
      reportMarkdown,
      messages: JSON.stringify([
        {role: 'system', content: built.systemPrompt},
        {role: 'user', content: built.userPrompt},
      ]),
    }).id;
  }

  return {
    reportId,
    reportMarkdown,
    mode,
    llmUsed,
    requestCount: requests.length,
  };
}
