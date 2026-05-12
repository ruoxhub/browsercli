/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {zod} from '../../third_party/index.js';
import type {ToolCategory} from '../categories.js';

/**
 * 单个步骤的执行结果
 */
export interface StepResult {
  /** 步骤名称 */
  step: string;
  /** 执行状态 */
  status: 'ok' | 'error' | 'skipped';
  /** 步骤产出数据 */
  data: unknown;
  /** 错误信息 (status=error 时) */
  error?: string;
  /** 执行耗时 (毫秒) */
  durationMs: number;
  /** 重试次数 */
  retries: number;
}

/**
 * 在步骤间传递的共享上下文。
 * 每个步骤接收当前上下文，返回部分更新（浅合并）。
 */
export interface PipelineContext {
  /** 原始工具输入参数 */
  input: Readonly<Record<string, unknown>>;
  /** 已完成的步骤结果 (keyed by step name) */
  steps: Readonly<Record<string, StepResult>>;
  /** 上一步结果（便捷访问） */
  prev: StepResult | null;
}

/**
 * Pipeline 步骤函数签名。
 * 接收当前上下文，返回要合并入上下文的增量数据。
 */
export type StepFn = (ctx: PipelineContext) => Promise<{
  data?: unknown;
  [key: string]: unknown;
}>;

/**
 * 单个 Pipeline 步骤定义
 */
export interface PipelineStep {
  /** 步骤名（唯一标识） */
  name: string;
  /** 步骤执行函数 */
  fn: StepFn;
  /**
   * 错误处理策略：
   * - 'fail': 立即终止 pipeline（默认）
   * - 'skip': 跳过当前步骤，继续执行后续步骤
   * - 'continue': 忽略错误，继续执行
   */
  onError?: 'fail' | 'skip' | 'continue';
  /** 失败时最大重试次数 (默认 0) */
  retry?: number;
}

/**
 * Pipeline 定义（definePipeline 的输入）
 */
export interface PipelineDef<
  Schema extends zod.ZodRawShape = zod.ZodRawShape,
> {
  /** 工具名称 */
  name: string;
  /** 别名 */
  aliases?: string[];
  /** 工具描述 */
  description: string;
  /** 工具注解 */
  annotations: {
    title?: string;
    category: ToolCategory;
    readOnlyHint: boolean;
  };
  /** Zod schema 定义输入参数 */
  schema: Schema;
  /** 步骤列表 */
  steps: PipelineStep[];
  /** 全局超时 (毫秒)，默认 300_000 (5分钟) */
  timeoutMs?: number;
}
