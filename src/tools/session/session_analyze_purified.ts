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

export const sessionAnalyzePurified = defineTool({
  name: 'session_analyze_purified',
  description:
    '执行 Phase 1 规则探测与降噪提纯，输出高价值请求、场景推断与加密代码切片，供 AI Agent 直接消费。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
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

    response.setStructuredContent({
      sessionId: session.id,
      mode: builtMode,
      sceneHints,
      purifiedRequests,
      cryptoSnippets,
      recommendedPrompt: `${built.systemPrompt}\n\n${built.userPrompt}`,
      tooltype: 'session_analyze_purified',
    });
  },
});
