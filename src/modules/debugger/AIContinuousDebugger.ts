/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * AIContinuousDebugger - AI 辅助连续调试
 *
 * 功能:
 * 1. XHR 断点 → JS 断点两阶段工作流
 * 2. AI 连续调试循环（等待断点 → AI 分析 → 执行决策）
 *
 * 设计原则:
 * - 复用现有的 DebuggerManager 和 AIService
 * - 不创建独立的 CDP 会话
 * - 支持随时中断
 */

import type {AIService} from '../../services/AIService.js';
import {logger} from '../../utils/logger.js';

import type {DebuggerManager, CallFrame} from './DebuggerManager.js';
import type {XHRBreakpointManager} from './XHRBreakpointManager.js';

// ==================== 类型定义 ====================

export interface ContinuousDebugConfig {
  /** 可选：调试开始前导航到的目标 URL */
  targetUrl?: string;

  /** 可选：XHR 断点 URL 模式列表 */
  xhrBreakPatterns?: string[];

  /** 最大迭代次数 (默认 50) */
  maxIterations?: number;

  /** 超时时间毫秒 (默认 300000 = 5 分钟) */
  timeoutMs?: number;

  /** AI 提供商 (默认使用 AIService 配置) */
  aiProvider?: 'openai' | 'anthropic' | 'gemini';

  /** 模型名称 (可选) */
  model?: string;

  /** 系统提示词覆盖 (可选) */
  systemPrompt?: string;
}

export interface DebugInfo {
  /** 断点位置 */
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
    url: string;
  };

  /** 调用栈 */
  callStack: CallFrame[];

  /** 作用域变量 */
  scopeVariables: Array<{
    name: string;
    value: any;
    type: string;
    scope: string;
  }>;

  /** 断点命中次数 */
  hitCount: number;

  /** 迭代次数 */
  iteration: number;
}

export interface Decision {
  /** 决策动作 */
  action: 'step_into' | 'step_over' | 'step_out' | 'resume' | 'stop';

  /** 决策理由 */
  reason: string;

  /** 置信度 (0-1) */
  confidence: number;

  /** 可选：下一步建议 */
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

// ==================== 系统提示词 ====================

const DEFAULT_SYSTEM_PROMPT = `你是一个专业的 JavaScript 逆向工程助手。你的任务是分析调试器暂停状态，决定下一步调试策略。

可用的调试动作:
- step_into: 进入当前行调用的函数内部。适用于：当前行有函数调用，且你想深入其实现
- step_over: 执行当前行，停在下一行（不进入函数）。适用于：跳过已理解的代码或库函数
- step_out: 执行完当前函数剩余部分，停在调用者。适用于：当前栈太深，想回到上层
- resume: 继续执行直到下一个断点。适用于：当前已理解，想快速到下一个关键点
- stop: 结束调试会话。适用于：已收集足够信息或发现目标

分析策略:
1. 优先深入业务逻辑代码，跳过框架/库代码 (vendor, node_modules, CDN 等)
2. 在关键数据转换处暂停分析
3. 避免在循环中无限跟踪 - 检测到重复位置时建议 resume
4. 当栈深度过深 (>10 层) 时考虑 step_out
5. 如果作用域中出现敏感数据 (token, key, password 等),建议 step_over 或 step_out 观察其使用

请以 JSON 格式返回决策，格式如下:
{
  "action": "step_into|step_over|step_out|resume|stop",
  "reason": "决策理由，解释为什么选择这个动作",
  "confidence": 0.8,
  "nextSuggestion": "可选的下一步建议"
}`;

// ==================== AIContinuousDebugger 类 ====================

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
  private iterationHistory: Array<{
    debugInfo: DebugInfo;
    decision: Decision;
    timestamp: number;
  }> = [];

  constructor(
    private debuggerManager: DebuggerManager,
    private xhrManager: XHRBreakpointManager,
    private aiService: AIService,
  ) {}

  /**
   * 获取当前状态
   */
  getStatus(): ContinuousDebugStatus {
    return this.status;
  }

  /**
   * 获取统计信息
   */
  getStats(): DebugSessionStats {
    return {...this.stats};
  }

  /**
   * 获取迭代历史
   */
  getIterationHistory(): typeof this.iterationHistory {
    return [...this.iterationHistory];
  }

  /**
   * 停止调试循环
   */
  async stop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort('User requested stop');
    }
    this.status = 'stopped';
    logger.info('AI continuous debugging stopped by user');
  }

  /**
   * 启动 AI 连续调试
   */
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
      // 阶段 1: 如果配置了 XHR 断点，先执行两阶段工作流
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

      // 阶段 2: 启动连续调试循环
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

  /**
   * XHR → JS 断点两阶段工作流
   */
  async xhrToJsBreakpoint(urlPattern: string): Promise<XhrToJsResult> {
    // 阶段 1: 设置 XHR 断点并等待触发
    const breakpointId = await this.xhrManager.setXHRBreakpoint(urlPattern);
    logger.info(
      `XHR breakpoint set: ${breakpointId} for pattern: ${urlPattern}`,
    );

    try {
      // 等待 XHR 断点触发 (最多等待 30 秒)
      const pausedState = await this.debuggerManager.waitForPaused(30000);

      // 获取调用栈
      const callStack = pausedState.callFrames;
      logger.info(`XHR breakpoint hit. Call stack depth: ${callStack.length}`);

      // 阶段 2: 识别顶层用户代码位置
      const targetFrame = this.findUserCodeFrame(callStack);
      logger.info('Target user code frame:', {
        functionName: targetFrame.functionName,
        url: targetFrame.url,
        lineNumber: targetFrame.location.lineNumber,
      });

      // 在目标位置设置 JS 断点
      const breakpointInfo = await this.debuggerManager.setBreakpoint({
        scriptId: targetFrame.location.scriptId,
        lineNumber: targetFrame.location.lineNumber,
        columnNumber: targetFrame.location.columnNumber,
      });

      logger.info(`JS breakpoint set: ${breakpointInfo.breakpointId}`);

      // 移除 XHR 断点
      await this.xhrManager.removeXHRBreakpoint(breakpointId);
      logger.info(`XHR breakpoint removed: ${breakpointId}`);

      // 恢复执行，等待 JS 断点触发
      await this.debuggerManager.resume();

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
      // 超时或其他错误，清理 XHR 断点
      await this.xhrManager.removeXHRBreakpoint(breakpointId).catch(() => {
        /* no-op */
      });
      throw error;
    }
  }

  /**
   * 从调用栈中识别用户代码帧
   */
  private findUserCodeFrame(callStack: CallFrame[]): CallFrame {
    // 跳过 vendor/库代码的过滤规则
    const vendorPatterns = [
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
    ];

    // 从栈顶向下找，找到第一个用户代码帧
    for (const frame of callStack) {
      const url = frame.url || '';
      const functionName = frame.functionName || '';

      // 检查是否是 vendor 代码
      const isVendor = vendorPatterns.some(
        pattern => url.includes(pattern) || functionName.includes(pattern),
      );

      // 检查是否是匿名函数或内部函数（通常是业务代码）
      const isUserCode =
        !isVendor &&
        (url.includes(window.location.hostname) || url.startsWith('/') || !url);

      if (isUserCode) {
        return frame;
      }
    }

    // 如果没有找到用户代码，返回栈顶帧
    return callStack[0] || callStack[0];
  }

  /**
   * 运行连续调试循环
   */
  private async runContinuousLoop(
    config: ContinuousDebugConfig,
  ): Promise<void> {
    const maxIterations = config.maxIterations ?? 50;
    const timeoutMs = config.timeoutMs ?? 300000;
    const startTime = Date.now();
    const aiLatencies: number[] = [];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // 检查超时
      if (Date.now() - startTime > timeoutMs) {
        logger.info('Debug loop timeout reached');
        this.status = 'timeout';
        break;
      }

      // 检查用户中止
      if (this.abortController?.signal.aborted) {
        logger.info('Debug loop aborted by user');
        break;
      }

      try {
        // 等待断点触发
        this.status = 'waiting_breakpoint';
        const pausedState = await this.debuggerManager.waitForPaused(5000);

        // 收集调试信息
        const debugInfo = await this.collectDebugInfo(pausedState, iteration);
        logger.info(`Iteration ${iteration + 1}: Debug info collected`);

        // AI 分析决策
        this.status = 'analyzing';
        const aiStartTime = Date.now();
        const decision = await this.analyzeAndDecide(debugInfo, config);
        const aiLatency = Date.now() - aiStartTime;
        aiLatencies.push(aiLatency);

        logger.info(
          `Iteration ${iteration + 1}: Decision - ${decision.action} (${decision.reason})`,
        );

        // 记录统计
        this.stats.iterations++;
        this.stats.decisions[decision.action] =
          (this.stats.decisions[decision.action] ?? 0) + 1;
        this.stats.avgAiLatencyMs =
          aiLatencies.reduce((a, b) => a + b, 0) / aiLatencies.length;

        // 记录历史
        this.iterationHistory.push({
          debugInfo,
          decision,
          timestamp: Date.now(),
        });

        // 执行决策
        this.status = 'executing';
        await this.executeDecision(decision);

        // 如果决策是 stop，结束循环
        if (decision.action === 'stop') {
          logger.info('AI decided to stop the debugging session');
          break;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Iteration ${iteration + 1} error:`, errorMsg);
        this.stats.errors.push(errorMsg);

        // 尝试恢复执行
        try {
          await this.debuggerManager.resume();
        } catch (resumeError) {
          logger.error('Failed to resume after error:', resumeError);
          throw error; // 重新抛出错误，结束循环
        }
      }
    }
  }

  /**
   * 收集调试信息
   */
  private async collectDebugInfo(
    pausedState: any,
    iteration: number,
  ): Promise<DebugInfo> {
    const topFrame = pausedState.callFrames[0];

    // 获取作用域变量
    const scopeResult = await this.debuggerManager.getScopeVariables({
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

  /**
   * AI 分析并决策
   */
  private async analyzeAndDecide(
    debugInfo: DebugInfo,
    config: ContinuousDebugConfig,
  ): Promise<Decision> {
    const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    // 构建用户提示词
    const userPrompt = this.buildUserPrompt(debugInfo);

    try {
      const response = await this.aiService.chat(
        [
          {role: 'system', content: systemPrompt},
          {role: 'user', content: userPrompt},
        ],
        {
          temperature: 0.1,
          maxTokens: 500,
        },
      );

      // 解析 JSON 响应
      const content = response.content?.trim();
      if (!content) {
        throw new Error('Empty AI response');
      }

      const decision = JSON.parse(content) as Decision;

      // 验证决策有效性
      if (
        !['step_into', 'step_over', 'step_out', 'resume', 'stop'].includes(
          decision.action,
        )
      ) {
        logger.warn('Invalid AI decision, defaulting to step_over:', decision);
        return {
          action: 'step_over',
          reason: 'Invalid AI response, using default',
          confidence: 0.5,
        };
      }

      return decision;
    } catch (error) {
      logger.error('AI analysis failed:', error);

      // 重试逻辑 (最多 2 次)
      for (let i = 0; i < 2; i++) {
        try {
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * Math.pow(2, i)),
          );
          const response = await this.aiService.chat(
            [
              {role: 'system', content: systemPrompt},
              {role: 'user', content: userPrompt},
            ],
            {
              temperature: 0.1,
              maxTokens: 500,
            },
          );

          const decision = JSON.parse(
            response.content?.trim() ?? '{}',
          ) as Decision;
          if (decision.action) {
            return decision;
          }
        } catch {
          continue;
        }
      }

      // 所有重试失败，返回默认决策
      return {
        action: 'step_over',
        reason: 'Default decision after AI failure',
        confidence: 0.5,
      };
    }
  }

  /**
   * 构建用户提示词
   */
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
          typeof v.value === 'object'
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

  /**
   * 执行决策
   */
  private async executeDecision(decision: Decision): Promise<void> {
    switch (decision.action) {
      case 'step_into':
        await this.debuggerManager.stepInto();
        break;
      case 'step_over':
        await this.debuggerManager.stepOver();
        break;
      case 'step_out':
        await this.debuggerManager.stepOut();
        break;
      case 'resume':
        await this.debuggerManager.resume();
        break;
      case 'stop':
        // 不需要执行任何动作，循环会自然结束
        break;
      default:
        logger.warn('Unknown decision action:', decision.action);
    }
  }

  /**
   * 关闭并清理资源
   */

  async close(): Promise<void> {
    await this.stop();
    this.iterationHistory = [];
    logger.info('AIContinuousDebugger closed');
  }
}
