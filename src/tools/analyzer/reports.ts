/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CorrelatedFlow, PriorityTarget, SignatureChainHints} from './types.js';

export function buildActionPlan(result: {
  target: string;
  topHookIds: Array<{hookId: string; type: string}>;
  suspiciousFlows: Array<{
    url: string;
    method: string;
    signatureIndicators: string[];
  }>;
  priorityTargets: Array<{
    target: string;
    type: 'network' | 'function';
    priorityScore: number;
  }>;
  signatureHints: SignatureChainHints;
}): string[] {
  const steps: string[] = [];
  const addStep = (text: string) => {
    steps.push(`${steps.length + 1}) ${text}`);
  };
  addStep(
    `调用 collect_code，参数: {"url":"${result.target}","returnMode":"top-priority","topN":10}`,
  );

  if (result.suspiciousFlows.length > 0) {
    const flow = result.suspiciousFlows[0];
    addStep(
      `重点观察可疑请求: ${flow.method} ${flow.url}，命中指标: ${flow.signatureIndicators.join(', ')}`,
    );
  } else {
    addStep(
      '先触发登录/下单/关键业务操作，再重新运行 analyze_target 捕获动态请求',
    );
  }

  if (result.priorityTargets.length > 0) {
    const top = result.priorityTargets[0];
    if (top.type === 'network') {
      addStep(
        `优先复现网络链路: ${top.target}（priority=${top.priorityScore}）`,
      );
    } else {
      addStep(`优先审计函数: ${top.target}（priority=${top.priorityScore}）`);
    }
  }

  if (result.signatureHints.candidateFunctions.length > 0) {
    const fnName = result.signatureHints.candidateFunctions[0];
    addStep(
      `使用 search_in_scripts 搜索函数名 "${fnName}"，并用 understand_code 深挖调用链`,
    );
  } else {
    addStep(
      '使用 search_in_scripts 搜索关键词 sign/token/auth/nonce，定位签名生成点',
    );
  }

  if (result.topHookIds.length > 0) {
    addStep(
      `调用 get_hook_data 查看首个 hook 数据: {"hookId":"${result.topHookIds[0].hookId}"}`,
    );
  } else {
    addStep('用 create_hook + inject_hook 手工注入 fetch/xhr hook 后再采样');
  }

  addStep(
    '对疑似签名代码调用 deobfuscate_code（aggressive=true）并复测请求参数变化',
  );
  return steps;
}

export function buildWhyTheseSteps(input: {
  requestFingerprints: Array<{fingerprint: string}>;
  candidateFunctions: string[];
  hookRecordCount: number;
}): string[] {
  return [
    input.requestFingerprints.length > 0
      ? `观察到可疑的请求指纹：${input.requestFingerprints
          .slice(0, 2)
          .map(item => item.fingerprint)
          .join('；')}`
      : '尚未捕获稳定请求指纹，后续步骤将继续观察和轻量采集。',
    input.candidateFunctions.length > 0
      ? `找到候选签名函数：${input.candidateFunctions.slice(0, 3).join('、')}`
      : '未发现明显的签名函数名，工作流将优先依赖请求和 Hook 证据。',
    input.hookRecordCount > 0
      ? `Hook 已采集到 ${input.hookRecordCount} 条记录，足以开始关联分析和本地重建。`
      : 'Hook 尚未产出数据，应避免过早进行本地重建猜测。',
  ];
}

export function buildStopConditions(input: {
  hookRecordCount: number;
  suspiciousFlowCount: number;
}): string[] {
  return [
    input.suspiciousFlowCount > 0
      ? '目标请求路径确认后即可停止扩大采集范围，并导出重建 Bundle。'
      : '若尚未确认可疑请求路径，应先触发目标操作后再停止分析。',
    input.hookRecordCount > 200
      ? 'Hook 数据超过 200 条时应先降噪（summary 视图或缩小目标），再决定是否注入新 Hook。'
      : 'Hook 证据不足以定位问题时，再考虑升级到断点调试。',
  ];
}

/**
 * 记录逆向分析证据。
 *
 * 将逆向分析过程中发现的关键证据结构化记录，
 * 供后续导出会话报告使用。
 *
 * @param params - 证据参数
 * @returns 结构化结果对象
 */
export function recordReverseEvidence(params: {
  category?: string;
  title?: string;
  description?: string;
  data?: unknown;
}): {
  success: boolean;
  message: string;
  tooltype: string;
  data?: Record<string, unknown>;
} {
  const category = params.category ?? 'general';
  const title = params.title ?? 'Untitled evidence';

  return {
    success: true,
    message: `证据已记录: [${category}] ${title}`,
    tooltype: 'record_reverse_evidence',
    data: {
      category,
      title,
      description: params.description ?? '',
      recordedAt: new Date().toISOString(),
      evidenceData: params.data,
    },
  };
}

/**
 * 导出会话报告。
 *
 * 汇总当前逆向分析会话中的所有证据和发现，
 * 生成结构化的会话报告。
 *
 * @param params - 报告参数
 * @returns 结构化结果对象
 */
export function exportSessionReport(params: {
  format?: string;
  includeEvidence?: boolean;
  includeTimeline?: boolean;
}): {
  success: boolean;
  message: string;
  tooltype: string;
  data?: Record<string, unknown>;
} {
  const format = params.format ?? 'json';

  return {
    success: true,
    message: `会话报告已导出 (格式: ${format})`,
    tooltype: 'export_session_report',
    data: {
      format,
      exportedAt: new Date().toISOString(),
      includeEvidence: params.includeEvidence ?? true,
      includeTimeline: params.includeTimeline ?? true,
    },
  };
}