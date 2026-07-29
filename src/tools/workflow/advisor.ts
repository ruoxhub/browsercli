/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {recommendNextStep} from '../../modules/workflows/NextStepAdvisor.js';
import {getReverseStageGuide} from '../../modules/workflows/ReverseStageGuide.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {ReverseTaskState} from '../../types/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

interface RecommendNextStepParams {
  taskId?: string;
  browserHealthy?: boolean;
  pageReady?: boolean;
  taskGoal?: string;
  currentStage?:
    | 'Observe'
    | 'Capture'
    | 'Rebuild'
    | 'Patch'
    | 'DeepDive'
    | 'PureExtraction'
    | 'Port';
  taskStatus?: string;
  hasTargetRequest?: boolean;
  hookRecordCount?: number;
  hasRebuildBundle?: boolean;
  hasPassingRebuild?: boolean;
  firstDivergenceKnown?: boolean;
}

async function buildTaskAwareAdvice(params: RecommendNextStepParams) {
  if (!params.taskId) {
    return recommendNextStep(params);
  }

  const runtime = getRuntime();
  const [taskState, taskDescriptor, runtimeEvidence] = await Promise.all([
    runtime.reverseTaskStore.readSnapshot<ReverseTaskState>(
      params.taskId,
      'state.json',
    ),
    runtime.reverseTaskStore.readSnapshot<Record<string, unknown>>(
      params.taskId,
      'task.json',
    ),
    runtime.reverseTaskStore.readLog('runtime-evidence', params.taskId),
  ]);

  const hasTargetRequest =
    params.hasTargetRequest ??
    (Boolean(
      (taskDescriptor?.targetContext as Record<string, unknown> | undefined)
        ?.targetRequest,
    ) ||
      [
        'Capture',
        'Rebuild',
        'Patch',
        'DeepDive',
        'PureExtraction',
        'Port',
      ].includes(
        String(taskState?.currentStage ?? taskDescriptor?.currentStage ?? ''),
      ) ||
      runtimeEvidence.some(entry => Boolean(entry.request)));
  const hookRecordCount =
    params.hookRecordCount ??
    runtimeEvidence.filter(
      entry => entry.kind === 'hook-hit' || entry.source === 'hook',
    ).length;
  const successCriteria = (taskState?.successCriteria ??
    taskDescriptor?.successCriteria ??
    {}) as Record<string, unknown>;
  const hasRebuildBundle =
    params.hasRebuildBundle ??
    (['Rebuild', 'Patch', 'PureExtraction', 'Port'].includes(
      String(taskState?.currentStage ?? taskDescriptor?.currentStage ?? ''),
    ) ||
      ['pass', 'partial'].includes(String(successCriteria.localRebuild ?? '')));
  const localRebuild = successCriteria.localRebuild;
  const currentStage =
    params.currentStage ??
    taskState?.currentStage ??
    String(taskDescriptor?.currentStage ?? 'Observe');
  const advice = recommendNextStep({
    ...params,
    currentStage,
    taskStatus: params.taskStatus ?? taskState?.status,
    taskGoal: params.taskGoal ?? String(taskDescriptor?.goal ?? ''),
    hasTargetRequest,
    hookRecordCount,
    hasRebuildBundle,
    hasPassingRebuild: params.hasPassingRebuild ?? localRebuild === 'pass',
  });

  return {
    ...advice,
    taskContext: {
      taskId: params.taskId,
      currentStage,
      taskStatus: taskState?.status ?? 'active',
      hookRecordCount,
      hasTargetRequest,
      hasRebuildBundle,
    },
  };
}

export const recommendNextStepTool = defineTool({
  name: 'recommend_next_step',
  description:
    '根据轻量级工作流信号，推荐下一步的逆向工程动作。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    taskId: zod.string().optional(),
    browserHealthy: zod.boolean().optional(),
    pageReady: zod.boolean().optional(),
    taskGoal: zod.string().optional(),
    currentStage: zod
      .enum([
        'Observe',
        'Capture',
        'Rebuild',
        'Patch',
        'DeepDive',
        'PureExtraction',
        'Port',
      ])
      .optional(),
    taskStatus: zod.string().optional(),
    hasTargetRequest: zod.boolean().optional(),
    hookRecordCount: zod.number().int().nonnegative().optional(),
    hasRebuildBundle: zod.boolean().optional(),
    hasPassingRebuild: zod.boolean().optional(),
    firstDivergenceKnown: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const advice = await buildTaskAwareAdvice(request.params);
    const stage =
      typeof advice === 'object' && advice !== null && 'stage' in advice
        ? (advice as {stage: string}).stage
        : undefined;
    response.setStructuredContent({
      success: true,
      message: stage ? `推荐下一步: ${stage}` : '已生成下一步建议',
      tooltype: 'recommend_next_step',
      data: advice,
    });
  },
});

export const explainReverseStage = defineTool({
  name: 'explain_reverse_stage',
  description:
    '解释某个逆向工程阶段的目标、进入条件、避免事项与推荐工具。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    stage: zod
      .string()
      .optional()
      .describe(
        '逆向阶段名：Observe / Capture / Rebuild / Patch / DeepDive / PureExtraction / Port',
      ),
    includeDocs: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    try {
      const stage = request.params.stage ?? 'Observe';
      let guide: ReturnType<typeof getReverseStageGuide> | null = null;
      try {
        guide = getReverseStageGuide(stage as never);
      } catch {
        guide = null;
      }

      if (!guide) {
        response.setStructuredContent({
          success: false,
          message: `未知的逆向阶段：${stage}。可选阶段：Observe, Capture, Rebuild, Patch, DeepDive, PureExtraction, Port。`,
          tooltype: 'explain_reverse_stage',
          data: {
            validStages: [
              'Observe',
              'Capture',
              'Rebuild',
              'Patch',
              'DeepDive',
              'PureExtraction',
              'Port',
            ],
          },
        });
        return;
      }

      const payload =
        request.params.includeDocs === false
          ? {...guide, docRefs: undefined}
          : guide;
      response.setStructuredContent({
        success: true,
        message: `逆向阶段说明: ${stage}`,
        tooltype: 'explain_reverse_stage',
        data: payload,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `解释逆向阶段失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'explain_reverse_stage',
        data: {},
      });
    }
  },
});
