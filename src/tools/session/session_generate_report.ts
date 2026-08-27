/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {CryptoScriptExtractor} from '../../modules/analyzer/ai/CryptoScriptExtractor.js';
import {PromptBuilder} from '../../modules/analyzer/ai/PromptBuilder.js';
import {SceneDetector} from '../../modules/analyzer/ai/SceneDetector.js';
import {TrafficPurifier} from '../../modules/analyzer/ai/TrafficPurifier.js';
import type {AnalysisMode} from '../../modules/analyzer/ai/types.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const sessionGenerateReport = defineTool({
  name: 'session_generate_report',
  description:
    '基于提纯结果与指定分析模式触发 AI 报告生成，并将结果持久化到 ai_reports 表。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    sessionId: zod.string().optional().describe('会话 ID，默认当前活动会话。'),
    mode: zod
      .enum(['auto', 'api_reverse', 'security', 'perf', 'js_crypto'])
      .optional()
      .describe('分析模式，默认 auto。'),
  },
  handler: async (request, response) => {
    const {sessionId, mode} = request.params as {
      sessionId?: string;
      mode?: AnalysisMode;
    };

    const manager = getRuntime().captureSessionManager;

    let session;
    if (sessionId) {
      session = manager.getSession(sessionId);
      if (!session) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `No session found with id: ${sessionId}`,
        );
      }
    } else {
      session = manager.requireActiveSession();
    }

    const requests = manager.getRequests(session.id);
    const hooks = manager.getHooks(session.id);

    const sceneHints = new SceneDetector().detect(requests, hooks);
    const purifiedRequests = new TrafficPurifier().purify(requests);
    const extractor = new CryptoScriptExtractor();
    const cryptoSnippets = extractor.extractSnippets(hooks, url => {
      return getRuntime().collector.getFileByUrl(url)?.content ?? null;
    });

    const builtMode: AnalysisMode = mode ?? 'auto';
    const built = new PromptBuilder().buildPrompt({
      mode: builtMode,
      sceneHints,
      purifiedRequests,
      cryptoSnippets,
      targetUrl: session.targetUrl,
    });

    const llm = getRuntime().llmService;
    let reportMarkdown: string;
    let llmUsed = false;
    if (llm.isConfigured()) {
      try {
        const res = await llm.chat([
          {role: 'system', content: built.systemPrompt},
          {role: 'user', content: built.userPrompt},
        ]);
        reportMarkdown = typeof res === 'string' ? res : res.content;
        llmUsed = true;
      } catch {
        reportMarkdown = built.fallbackReport;
      }
    } else {
      reportMarkdown = built.fallbackReport;
    }

    const saved = manager.saveReport({
      sessionId: session.id,
      mode: builtMode,
      sceneHints: JSON.stringify(sceneHints),
      purifiedSummary: JSON.stringify({count: purifiedRequests.length}),
      reportMarkdown,
      messages: JSON.stringify([
        {role: 'system', content: built.systemPrompt},
        {role: 'user', content: built.userPrompt},
      ]),
    });

    response.setStructuredContent({
      reportId: saved.id,
      reportMarkdown,
      mode: builtMode,
      llmUsed,
      tooltype: 'session_generate_report',
    });
  },
});
