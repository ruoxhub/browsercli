/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {definePipeline, parallel, when} from './definePipeline.js';
import type {PipelineContext} from './types.js';

/**
 * 分析流水线 — 演示 Pipeline 编排模式
 *
 * 组合三个分析阶段：
 *  1. 采集 (collect) - 收集目标信息
 *  2. 并行分析 (analyze) - 同时进行加密检测和混淆分析
 *  3. 报告 (report) - 汇总生成评估
 *
 * 可以在 TOOL_REGISTRY 中注册为独立工具使用。
 */

// 模拟分析函数原型（实际使用时替换为真实模块调用）
function simulateCollection(url: string) {
  return {
    url,
    scriptsFound: Math.floor(Math.random() * 20) + 1,
    totalSize: Math.floor(Math.random() * 1000000),
    collectionTimeMs: Math.floor(Math.random() * 5000),
  };
}

function simulateCryptoAnalysis(collectionResult: unknown) {
  return {
    algorithms: ['AES', 'RSA'],
    libraries: ['CryptoJS'],
    riskLevel: 'medium',
  };
}

function simulateObfuscationAnalysis(collectionResult: unknown) {
  return {
    detected: true,
    types: ['control_flow_flattening', 'string_array'],
    tool: 'obfuscator.io',
  };
}

export const analyzePipeline = definePipeline({
  name: 'analyze_pipeline',
  aliases: ['analyze-flow'],
  description:
    '分析流水线：采集 → 并行分析(加密检测+混淆分析) → 生成报告。演示 Pipeline 编排模式的完整工作流。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    url: zod.string().describe('目标 URL'),
    deep: zod.boolean().optional().describe('是否深度分析'),
  },
  steps: [
    {
      name: 'collect',
      fn: async (ctx: PipelineContext) => {
        const url = String(ctx.input.url);
        const collection = simulateCollection(url);
        return {data: collection};
      },
    },
    parallel(
      'analyze',
      [
        {
          fn: async (ctx: PipelineContext) => {
            const prevData = ctx.prev?.data;
            return {crypto: simulateCryptoAnalysis(prevData)};
          },
        },
        {
          fn: async (ctx: PipelineContext) => {
            const prevData = ctx.prev?.data;
            return {obfuscation: simulateObfuscationAnalysis(prevData)};
          },
        },
      ],
      {onError: 'skip'},
    ),
    {
      name: 'report',
      fn: async (ctx: PipelineContext) => {
        const prevSteps = ctx.steps;
        const collectResult = prevSteps.collect?.data as
          | Record<string, unknown>
          | undefined;
        const analyzeData = (prevSteps.analyze?.data ?? {}) as Record<
          string,
          unknown
        >;
        const cryptoResult = (
          analyzeData['analyze[0]'] as Record<string, unknown> | undefined
        )?.crypto as Record<string, unknown> | undefined;
        const obfResult = (
          analyzeData['analyze[1]'] as Record<string, unknown> | undefined
        )?.obfuscation as Record<string, unknown> | undefined;

        return {
          data: {
            url: ctx.input.url,
            summary: {
              scriptsCount: collectResult?.scriptsFound ?? 0,
              totalSizeBytes: collectResult?.totalSize ?? 0,
              cryptoAlgorithms: cryptoResult?.algorithms ?? [],
              hasObfuscation: obfResult?.detected ?? false,
            },
            riskAssessment: 'medium',
            recommendation: 'Proceed with hook-based analysis',
          },
        };
      },
    },
  ],
});
