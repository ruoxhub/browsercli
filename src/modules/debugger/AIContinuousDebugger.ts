/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AIContinuousDebugger - AI 辅助连续调试
 *
 * 功能:
 * 1. XHR 断点 → JS 断点两阶段工作流
 * 2. AI 连续调试循环(等待断点 → AI 分析 → 执行决策)
 *
 * 设计原则:
 * - 复用现有的 DebuggerManager 和 AIService
 * - 不创建独立的 CDP 会话
 * - 支持随时中断
 */

import type {AIService, AIMessage} from '../../services/AIService.js';
import type {
  GetScopeVariablesOptions,
  GetScopeVariablesResult,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

import type {CallFrame, PausedState, BreakpointInfo} from './types.js';

export interface ContinuousDebugConfig {
  /** 可选:调试开始前导航到的目标 URL */
  targetUrl?: string;

  /** 可选:XHR 断点 URL 模式列表 */
  xhrBreakPatterns?: string[];

  /** 最大迭代次数(默认 50) */
  maxIterations?: number;

  /** 超时时间毫秒(默认 300000 = 5 分钟) */
  timeoutMs?: number;

  /** AI 提供商(默认使用 AIService 配置) */
  aiProvider?: 'openai';

  /** 模型名称(可选) */
  model?: string;

  /** 系统提示词覆盖(可选) */
  systemPrompt?: string;
}

export interface DebugInfo {
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
    url: string;
  };

  callStack: CallFrame[];

  scopeVariables: Array<{
    name: string;
    value: unknown;
    type: string;
    scope: string;
  }>;

  hitCount: number;

  iteration: number;
}

export interface Decision {
  action: 'step_into' | 'step_over' | 'step_out' | 'resume' | 'stop';
  reason: string;
  confidence: number;
  nextSuggestion?: string;
}

export type ContinuousDebugStatus =
  | 'idle'
  | 'waiting_xhr'
  | 'waiting_breakpoint'
  | 'analyzing'
  | 'executing'
  | 'stopped'
  | 'timeout'
  | 'error'
  | 'completed';

export interface DebugSessionStats {
  iterations: number;
  decisions: Record<string, number>;
  totalTimeMs: number;
  avgAiLatencyMs: number;
  errors: string[];
}

export interface XhrToJsResult {
  xhrBreakpointSet: boolean;
  jsBreakpointSet: boolean;
  callStack: CallFrame[];
  targetScript: {
    scriptId: string;
    lineNumber: number;
    url?: string;
  };
}

const VENDOR_PATTERNS = [
  'node_modules',
  'vendor',
  'webpack',
  'cdn.',
  'googleapis.com',
  'cloudflare.com',
  'amazonaws.com',
  '/dist/',
  '/build/',
  'min.js',
  '.min.',
] as const;

const VALID_ACTIONS: ReadonlyArray<Decision['action']> = [
  'step_into',
  'step_over',
  'step_out',
  'resume',
  'stop',
];

const DEFAULT_SYSTEM_PROMPT = `你是一个专业的 JavaScript 逆向工程助手。你的任务是分析调试器暂停状态,决定下一步调试策略。

可用的调试动作:
- step_into: 进入当前行调用的函数内部。适用于:当前行有函数调用,且你想深入其实现
- step_over: 执行当前行,停在下一行(不进入函数)。适用于:跳过已理解的代码或库函数
- step_out: 执行完当前函数剩余部分,停在调用者。适用于:当前栈太深,想回到上层
- resume: 继续执行直到下一个断点。适用于:当前已理解,想快速到下一个关键点
- stop: 结束调试会话。适用于:已收集足够信息或发现目标

分析策略:
1. 优先深入业务逻辑代码,跳过框架/库代码 (vendor, node_modules, CDN 等)
2. 在关键数据转换处暂停分析
3. 避免在循环中无限跟踪 - 检测到重复位置时建议 resume
4. 当栈深度过深 (>10 层) 时考虑 step_out
5. 如果作用域中出现敏感数据 (token, key, password 等),建议 step_over 或 step_out 观察其使用

请以 JSON 格式返回决策,格式如下:
{
  "action": "step_into|step_over|step_out|resume|stop",
  "reason": "决策理由,解释为什么选择这个动作",
  "confidence": 0.8,
  "nextSuggestion": "可选的下一步建议"
}`;

interface IterationRecord {
  debugInfo: DebugInfo;
  decision: Decision;
  timestamp: number;
}

export function extractJsonFromResponse(content: string): string {
  const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return match ? match[1].trim() : content.trim();
}

export interface ContinuousDebuggerDeps {
  setXHRBreakpoint: (urlPattern: string) => Promise<string>;
  removeXHRBreakpoint: (id: string) => Promise<boolean>;
  setBreakpoint: (params: {
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }) => Promise<BreakpointInfo>;
  removeBreakpoint: (id: string) => Promise<void>;
  waitForPaused: (timeout?: number) => Promise<PausedState>;
  resume: () => Promise<void>;
  stepOver: () => Promise<void>;
  stepInto: () => Promise<void>;
  stepOut: () => Promise<void>;
  getScopeVariables: (
    options?: GetScopeVariablesOptions,
  ) => Promise<GetScopeVariablesResult>;
  evaluateOnCallFrame: (params: {
    callFrameId: string;
    expression: string;
    returnByValue?: boolean;
  }) => Promise<{
    result: {value?: unknown; type: string};
    exceptionDetails?: unknown;
  }>;
  getScripts: () => Array<{scriptId: string; url: string}>;
  targetHostname?: string;
}

export class AIContinuousDebugger {
  private status: ContinuousDebugStatus = 'idle';
  private abortController: AbortController | null = null;
  private stats: DebugSessionStats = {
    iterations: 0,
    decisions: {},
    totalTimeMs: 0,
    avgAiLatencyMs: 0,
    errors: [],
  };
  private iterationHistory: IterationRecord[] = [];
  private recentPauseLocations: Array<{
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
  }> = [];

  constructor(
    private deps: ContinuousDebuggerDeps,
    private aiService: AIService,
  ) {}

  getStatus(): ContinuousDebugStatus {
    return this.status;
  }

  getStats(): DebugSessionStats {
    return {...this.stats};
  }

  getIterationHistory(): IterationRecord[] {
    return [...this.iterationHistory];
  }

  async stop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort('User requested stop');
    }
    this.status = 'stopped';
    logger.info('AI continuous debugging stopped by user');
  }

  async start(config: ContinuousDebugConfig): Promise<void> {
    if (this.status !== 'idle' && this.status !== 'stopped') {
      throw new Error('Debugger is already running. Stop it first.');
    }

    this.abortController = new AbortController();
    this.status = 'waiting_breakpoint';
    this.stats = {
      iterations: 0,
      decisions: {},
      totalTimeMs: 0,
      avgAiLatencyMs: 0,
      errors: [],
    };
    this.iterationHistory = [];

    const startTime = Date.now();

    try {
      if (config.xhrBreakPatterns && config.xhrBreakPatterns.length > 0) {
        for (const pattern of config.xhrBreakPatterns) {
          if (this.abortController?.signal.aborted) {
            logger.info('Aborted during XHR breakpoint setup');
            return;
          }

          logger.info(`Setting up XHR breakpoint for pattern: ${pattern}`);
          this.status = 'waiting_xhr';

          const result = await this.xhrToJsBreakpoint(pattern);
          logger.info('XHR → JS breakpoint workflow completed', result);
        }
      }

      this.status = 'waiting_breakpoint';
      await this.runContinuousLoop(config);

      this.status = 'completed';
    } catch (error) {
      this.status = 'error';
      this.stats.errors.push(
        error instanceof Error ? error.message : String(error),
      );
      logger.error('AI continuous debugging error:', error);
      throw error;
    } finally {
      this.stats.totalTimeMs = Date.now() - startTime;
      this.abortController = null;
    }
  }

  /** XHR → JS 断点两阶段工作流 */
  async xhrToJsBreakpoint(urlPattern: string): Promise<XhrToJsResult> {
    const breakpointId = await this.deps.setXHRBreakpoint(urlPattern);
    logger.info(
      `XHR breakpoint set: ${breakpointId} for pattern: ${urlPattern}`,
    );

    try {
      const pausedState = await this.deps.waitForPaused(30000);
      const callStack = pausedState.callFrames;
      logger.info(`XHR breakpoint hit. Call stack depth: ${callStack.length}`);

      const targetFrame = this.findUserCodeFrame(callStack);
      logger.info('Target user code frame:', {
        functionName: targetFrame.functionName,
        url: targetFrame.url,
        lineNumber: targetFrame.location.lineNumber,
      });

      const breakpointInfo = await this.deps.setBreakpoint({
        scriptId: targetFrame.location.scriptId,
        lineNumber: targetFrame.location.lineNumber,
        columnNumber: targetFrame.location.columnNumber,
      });
      logger.info(`JS breakpoint set: ${breakpointInfo.breakpointId}`);

      await this.deps.removeXHRBreakpoint(breakpointId);
      logger.info(`XHR breakpoint removed: ${breakpointId}`);

      await this.deps.resume();

      return {
        xhrBreakpointSet: true,
        jsBreakpointSet: true,
        callStack,
        targetScript: {
          scriptId: targetFrame.location.scriptId,
          lineNumber: targetFrame.location.lineNumber,
          url: targetFrame.url,
        },
      };
    } catch (error) {
      await this.deps.removeXHRBreakpoint(breakpointId).catch(() => {});
      throw error;
    }
  }

  /** 从调用栈中识别用户代码帧 */
  private findUserCodeFrame(callStack: CallFrame[]): CallFrame {
    for (const frame of callStack) {
      const url = frame.url || '';
      const functionName = frame.functionName || '';

      const isVendor = VENDOR_PATTERNS.some(
        pattern => url.includes(pattern) || functionName.includes(pattern),
      );

      const hostname = this.deps.targetHostname ?? '';
      const isUserCode =
        !isVendor &&
        ((hostname && url.includes(hostname)) || url.startsWith('/') || !url);

      if (isUserCode) {
        return frame;
      }
    }

    const first = callStack[0];
    if (!first) {
      throw new Error('Empty call stack');
    }
    return first;
  }

  private async runContinuousLoop(
    config: ContinuousDebugConfig,
  ): Promise<void> {
    const maxIterations = config.maxIterations ?? 50;
    const timeoutMs = config.timeoutMs ?? 300000;
    const startTime = Date.now();
    const aiLatencies: number[] = [];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (Date.now() - startTime > timeoutMs) {
        logger.info('Debug loop timeout reached');
        this.status = 'timeout';
        break;
      }

      if (this.abortController?.signal.aborted) {
        logger.info('Debug loop aborted by user');
        break;
      }

      try {
        this.status = 'waiting_breakpoint';
        const pausedState = await this.deps.waitForPaused(5000);

        // Loop detection
        const topLoc = pausedState.callFrames[0]?.location;
        if (topLoc) {
          this.recentPauseLocations.push({
            scriptId: topLoc.scriptId,
            lineNumber: topLoc.lineNumber,
            columnNumber: topLoc.columnNumber,
          });
          if (this.recentPauseLocations.length > 5) {
            this.recentPauseLocations.shift();
          }

          const lastThree = this.recentPauseLocations.slice(-3);
          if (
            lastThree.length === 3 &&
            lastThree.every(
              l =>
                l.scriptId === lastThree[0]!.scriptId &&
                l.lineNumber === lastThree[0]!.lineNumber &&
                l.columnNumber === lastThree[0]!.columnNumber,
            )
          ) {
            logger.warn('Loop detected at same location, auto-stepping over');
            await this.deps.stepOver();
            this.recentPauseLocations = [];
            continue;
          }
        }

        const debugInfo = await this.collectDebugInfo(pausedState, iteration);
        logger.info(`Iteration ${iteration + 1}: Debug info collected`);

        this.status = 'analyzing';
        const aiStartTime = Date.now();
        const decision = await this.analyzeAndDecide(debugInfo, config);
        const aiLatency = Date.now() - aiStartTime;
        aiLatencies.push(aiLatency);

        logger.info(
          `Iteration ${iteration + 1}: Decision - ${decision.action} (${decision.reason})`,
        );

        this.stats.iterations++;
        this.stats.decisions[decision.action] =
          (this.stats.decisions[decision.action] ?? 0) + 1;
        this.stats.avgAiLatencyMs =
          aiLatencies.reduce((a, b) => a + b, 0) / aiLatencies.length;

        this.iterationHistory.push({
          debugInfo,
          decision,
          timestamp: Date.now(),
        });

        this.status = 'executing';
        await this.executeDecision(decision);

        if (decision.action === 'stop') {
          logger.info('AI decided to stop the debugging session');
          break;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Iteration ${iteration + 1} error:`, errorMsg);
        this.stats.errors.push(errorMsg);

        try {
          await this.deps.resume();
        } catch (resumeError) {
          logger.error('Failed to resume after error:', resumeError);
          throw error;
        }
      }
    }
  }

  private async collectDebugInfo(
    pausedState: PausedState,
    iteration: number,
  ): Promise<DebugInfo> {
    const topFrame = pausedState.callFrames[0];
    if (!topFrame) {
      throw new Error('No call frame available for debug info collection');
    }

    const scopeResult = await this.deps.getScopeVariables({
      skipErrors: true,
      maxDepth: 1,
    });

    return {
      location: {
        scriptId: topFrame.location.scriptId,
        lineNumber: topFrame.location.lineNumber,
        columnNumber: topFrame.location.columnNumber,
        url: topFrame.url || '',
      },
      callStack: pausedState.callFrames,
      scopeVariables: scopeResult.variables.map(v => ({
        name: v.name,
        value: v.value,
        type: v.type,
        scope: v.scope,
      })),
      hitCount: this.stats.iterations + 1,
      iteration,
    };
  }

  private async analyzeAndDecide(
    debugInfo: DebugInfo,
    config: ContinuousDebugConfig,
  ): Promise<Decision> {
    const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const userPrompt = this.buildUserPrompt(debugInfo);

    return this.requestDecision(systemPrompt, userPrompt);
  }

  private async requestDecision(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<Decision> {
    const messages: AIMessage[] = [
      {role: 'system', content: systemPrompt},
      {role: 'user', content: userPrompt},
    ];

    try {
      return this.parseDecision(await this.callAi(messages));
    } catch (error) {
      logger.error('AI analysis failed, attempting retry:', error);
      return this.retryDecision(messages);
    }
  }

  private async callAi(messages: AIMessage[]): Promise<string> {
    const response = await this.aiService.chat(messages, {
      temperature: 0.1,
      maxTokens: 500,
    });
    return response.content?.trim() ?? '';
  }

  private parseDecision(content: string): Decision {
    if (!content) {
      throw new Error('Empty AI response');
    }

    const cleaned = extractJsonFromResponse(content);
    const decision = JSON.parse(cleaned) as Decision;

    if (!VALID_ACTIONS.includes(decision.action)) {
      logger.warn('Invalid AI decision, defaulting to step_over:', decision);
      return {
        action: 'step_over',
        reason: 'Invalid AI response, using default',
        confidence: 0.5,
      };
    }

    return decision;
  }

  private async retryDecision(messages: AIMessage[]): Promise<Decision> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.delayWithBackoff(attempt);
        return this.parseDecision(await this.callAi(messages));
      } catch {
        // continue to next attempt
      }
    }

    return {
      action: 'step_over',
      reason: 'Default decision after AI failure',
      confidence: 0.5,
    };
  }

  private delayWithBackoff(attempt: number): Promise<void> {
    const delayMs = 1000 * Math.pow(2, attempt);
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }

  private buildUserPrompt(debugInfo: DebugInfo): string {
    const callStackPreview = debugInfo.callStack
      .slice(0, 5)
      .map((frame, i) => {
        const functionName = frame.functionName || '(anonymous)';
        const location = frame.url
          ? `${frame.url}:${frame.location.lineNumber + 1}`
          : `script:${frame.location.scriptId}`;
        return `${i + 1}. ${functionName} @ ${location}`;
      })
      .join('\n');

    const scopeVarsPreview = debugInfo.scopeVariables
      .slice(0, 10)
      .map(v => {
        const valueStr =
          typeof v.value === 'object' && v.value !== null
            ? JSON.stringify(v.value).slice(0, 100)
            : String(v.value);
        return `  ${v.name} (${v.type}): ${valueStr}`;
      })
      .join('\n');

    return `## 当前调试状态

**断点位置**: ${debugInfo.location.url || 'inline'}:${debugInfo.location.lineNumber + 1}:${debugInfo.location.columnNumber + 1}
**迭代次数**: ${debugInfo.iteration + 1}

## 调用栈 (Top 5)

${callStackPreview || '(empty)'}

## 作用域变量 (Top 10)

${scopeVarsPreview || '(empty)'}

请分析当前状态并决定下一步调试动作。`;
  }

  private async executeDecision(decision: Decision): Promise<void> {
    switch (decision.action) {
      case 'step_into':
        await this.deps.stepInto();
        break;
      case 'step_over':
        await this.deps.stepOver();
        break;
      case 'step_out':
        await this.deps.stepOut();
        break;
      case 'resume':
        await this.deps.resume();
        break;
      case 'stop':
        // 循环会自然结束
        break;
      default:
        logger.warn('Unknown decision action:', decision.action);
    }
  }

  async close(): Promise<void> {
    await this.stop();
    this.iterationHistory = [];
    logger.info('AIContinuousDebugger closed');
  }
}
