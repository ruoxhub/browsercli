/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AnalysisMode,
  CryptoSnippet,
  PurifiedRequest,
  SceneHint,
} from './types.js';

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  fallbackReport: string;
}

export interface PromptInput {
  mode?: AnalysisMode;
  sceneHints: SceneHint[];
  purifiedRequests: PurifiedRequest[];
  cryptoSnippets: CryptoSnippet[];
  targetUrl?: string | null;
}

const ROLE_HEADER =
  '你是一名资深 Web 逆向与流量分析专家，擅长从抓包数据中还原接口链路、签名算法与加密逻辑。';

const SYSTEM_PROMPTS: Record<AnalysisMode, string> = {
  auto: `${ROLE_HEADER}\n当前分析模式: auto。请综合场景标签、高价值请求与加密代码切片，先判定业务场景（鉴权 / 签名 / 加密 / AI 流式 / 登录），再给出该会话最值得深入的逆向方向与下一步建议。`,
  api_reverse: `${ROLE_HEADER}\n当前分析模式: api_reverse。请侧重接口签名与入参结构：逐条分析高价值请求的 URL、方法、关键 Header 与 body 字段，还原本接口的参数构造顺序、必填/可选字段与签名入参，输出可复现的请求构造流程。`,
  security: `${ROLE_HEADER}\n当前分析模式: security。请侧重鉴权与传输安全：审查 Token 传递方式、鉴权绕过可能、明文传输敏感数据、签名参数可重放性与 Cookie/Header 安全属性，列出风险点与证据。`,
  perf: `${ROLE_HEADER}\n当前分析模式: perf。请侧重性能分析：结合请求时序与耗时，识别慢接口、重复请求、瀑布式串行依赖与大响应体，给出优化与并发化建议。`,
  js_crypto: `${ROLE_HEADER}\n当前分析模式: js_crypto。请侧重算法识别与密钥还原：分析加密代码切片中的函数（如 md5/sha/AES/RSA/SM 系列），推断算法、模式、padding、密钥与 IV 来源，并给出本地复现加密函数的路径。`,
};

const SUGGESTIONS: Record<AnalysisMode, string[]> = {
  auto: [
    '确认核心业务场景标签是否与预期一致，必要时补充抓包样本。',
    '优先针对置信度最高的场景（如 auth-token / signature-hash）展开 Phase 2 深入分析。',
    '将本报告的请求时序与加密切片作为上下文交给 AI Agent 做下一轮提纯。',
  ],
  api_reverse: [
    '挑选携带签名参数的高价值请求，还原参数拼装顺序与参与签名的字段集合。',
    '对关键接口做重放验证，确认必填 Header 与 Cookie 的最小集合。',
    '定位 writer/builder 函数（签名写入点），必要时用 Hook 采样入参与返回值。',
  ],
  security: [
    '检查 Authorization / Cookie 是否存在明文传输或可预测 Token。',
    '验证签名参数的时间戳与 nonce 防重放窗口，评估重放风险。',
    '审查敏感接口是否缺少鉴权校验（越权 / 未授权访问面）。',
  ],
  perf: [
    '按 durationMs 排序定位最慢请求，检查其响应体大小与内容类型。',
    '识别串行依赖的请求瀑布，评估并行化或预取机会。',
    '统计重复 / 轮询请求，建议缓存或合并策略。',
  ],
  js_crypto: [
    '沿加密切片中的函数名回溯调用链，定位 entry 与密钥常量。',
    '对 AES/RSA 等算法确认 mode/padding/IV，做本地加解密对齐验证。',
    '如源码混淆，先做 AST 解混再提取密钥派生逻辑。',
  ],
};

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export class PromptBuilder {
  buildPrompt(input: PromptInput): BuiltPrompt {
    const mode: AnalysisMode = input.mode ?? 'auto';
    const sceneHints = input.sceneHints;
    const purifiedRequests = input.purifiedRequests ?? [];
    const cryptoSnippets = input.cryptoSnippets ?? [];

    return {
      systemPrompt: SYSTEM_PROMPTS[mode],
      userPrompt: this.buildUserPrompt(
        mode,
        sceneHints,
        purifiedRequests,
        cryptoSnippets,
        input.targetUrl ?? null,
      ),
      fallbackReport: this.buildFallbackReport(
        mode,
        sceneHints,
        purifiedRequests,
        cryptoSnippets,
      ),
    };
  }

  private buildUserPrompt(
    mode: AnalysisMode,
    sceneHints: SceneHint[],
    requests: PurifiedRequest[],
    snippets: CryptoSnippet[],
    targetUrl: string | null,
  ): string {
    const lines: string[] = [
      `分析目标: ${targetUrl ?? '(未提供)'}`,
      `分析模式: ${mode}`,
      '',
      '## 场景推断',
    ];
    if (sceneHints.length === 0) {
      lines.push('- (无场景标签)');
    } else {
      for (const hint of sceneHints) {
        const urls = hint.matchedUrls?.length
          ? ` | matched: ${hint.matchedUrls.join(', ')}`
          : '';
        lines.push(
          `- [${hint.scene}] confidence=${hint.confidence}: ${hint.evidence}${urls}`,
        );
      }
    }

    lines.push('', `## 高价值请求 (${requests.length})`);
    if (requests.length === 0) {
      lines.push('- (无提纯请求)');
    } else {
      for (const req of requests) {
        const headers = Object.entries(req.keyHeaders)
          .map(([k, v]) => `${k}=${truncate(v, 64)}`)
          .join('; ');
        lines.push(
          `- #${req.sequence} ${req.method} ${req.url} -> ${req.statusCode} (${req.durationMs}ms)${headers ? `\n  headers: ${headers}` : ''}${req.bodyPreview ? `\n  body: ${truncate(req.bodyPreview, 200)}` : ''}`,
        );
      }
    }

    lines.push('', `## 加密代码切片 (${snippets.length})`);
    if (snippets.length === 0) {
      lines.push('- (无加密切片)');
    } else {
      for (const snippet of snippets) {
        const loc = snippet.line ? `:${snippet.line}` : '';
        lines.push(
          `- ${snippet.functionName} (${snippet.hookType}) @ ${snippet.file}${loc}\n  ${truncate(snippet.sourceSnippet, 300)}`,
        );
      }
    }

    lines.push('', '请基于以上提纯数据，按当前模式输出结构化分析结论。');
    return lines.join('\n');
  }

  private buildFallbackReport(
    mode: AnalysisMode,
    sceneHints: SceneHint[],
    requests: PurifiedRequest[],
    snippets: CryptoSnippet[],
  ): string {
    const lines: string[] = ['# AI 分析报告（离线降级）', ''];

    lines.push('## 分析模式', '', mode, '');

    lines.push('## 场景推断', '');
    if (sceneHints.length === 0) {
      lines.push('未检出场景标签。', '');
    } else {
      for (const hint of sceneHints) {
        lines.push(
          `- **${hint.scene}** (置信度: ${hint.confidence}) — ${hint.evidence}`,
        );
      }
      lines.push('');
    }

    lines.push('## 高价值请求', '');
    if (requests.length === 0) {
      lines.push('无高价值请求。', '');
    } else {
      lines.push('| 序号 | 方法 | URL | 状态码 |');
      lines.push('| --- | --- | --- | --- |');
      for (const req of requests) {
        lines.push(
          `| ${req.sequence} | ${req.method} | ${escapeCell(req.url)} | ${req.statusCode} |`,
        );
      }
      lines.push('');
    }

    lines.push('## 加密代码切片', '');
    if (snippets.length === 0) {
      lines.push('无加密代码切片。', '');
    } else {
      for (const snippet of snippets) {
        const loc = snippet.line ? ` (line ${snippet.line})` : '';
        lines.push(`- **${snippet.functionName}** — ${snippet.file}${loc}`);
      }
      lines.push('');
    }

    lines.push('## 建议', '');
    for (const suggestion of SUGGESTIONS[mode]) {
      lines.push(`- ${suggestion}`);
    }
    lines.push('');

    return lines.join('\n');
  }
}
