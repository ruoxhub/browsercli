/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {autoProgressReverseTask} from './ReverseTaskAutoProgress.js';
import type {
  ReverseTaskExecutableStep,
  ReverseTaskExecutionOverride,
} from './ReverseTaskExecutor.js';
import {getReverseTaskState} from './ReverseTaskQuery.js';
import {updateReverseTaskState} from './ReverseTaskState.js';
import type {ReverseTaskStore} from './ReverseTaskStore.js';
import {summarizeReverseTask} from './ReverseTaskSummary.js';
import {appendReverseTimeline} from './ReverseTaskTimeline.js';

export interface ExecutionAdapterContext {
  store: ReverseTaskStore;
  taskId: string;
  currentStage: string;
  step: ReverseTaskExecutableStep;
  override?: ReverseTaskExecutionOverride;
}

export interface ExecutionAdapterResult {
  result?: string;
  nextStage?: string;
}

export type ExecutionAdapter = (
  context: ExecutionAdapterContext,
) => Promise<ExecutionAdapterResult>;

function makeToolResponse(): {
  lines: string[];
  appendResponseLine(value: string): void;
} {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine(value: string) {
      lines.push(value);
    },
  };
}

function extractToolJson(lines: string[]): Record<string, unknown> | undefined {
  const start = lines.indexOf('```json');
  const end = lines.indexOf('```', start + 1);
  if (start < 0 || end < 0) {
    return undefined;
  }
  return JSON.parse(lines.slice(start + 1, end).join('\n')) as Record<
    string,
    unknown
  >;
}

async function readTaskDescriptor(
  store: ReverseTaskStore,
  taskId: string,
): Promise<Record<string, unknown>> {
  return (
    (await store.readSnapshot<Record<string, unknown>>(taskId, 'task.json')) ??
    {}
  );
}

async function inferRuntimeError(
  store: ReverseTaskStore,
  taskId: string,
): Promise<string> {
  const [state, timeline] = await Promise.all([
    store.readSnapshot<Record<string, unknown>>(taskId, 'state.json'),
    store.readLog('timeline', taskId),
  ]);
  const lastError = [...timeline]
    .reverse()
    .find(entry => String(entry.status ?? '') === 'error');
  if (
    typeof lastError?.result === 'string' &&
    lastError.result.trim().length > 0
  ) {
    return lastError.result;
  }
  if (
    typeof state?.currentSummary === 'string' &&
    state.currentSummary.trim().length > 0
  ) {
    return state.currentSummary;
  }
  return 'ReferenceError: window is not defined';
}

async function syncTaskState(
  store: ReverseTaskStore,
  taskId: string,
  currentStage: string,
  status: 'active' | 'partial',
  currentSummary: string,
): Promise<void> {
  await updateReverseTaskState(store, {
    taskId,
    currentStage,
    status,
    currentSummary,
    nextStepHint: 'manage_reverse_task:summarize',
  });
}

const manageReverseTaskAdapter: ExecutionAdapter = async ({
  store,
  taskId,
  currentStage,
  step,
}) => {
  const action = String(step.params.action ?? 'get');
  if (action === 'progress') {
    const progressed = await autoProgressReverseTask(store, taskId);
    return {
      result: `progressed to ${progressed.currentStage}`,
      nextStage: progressed.currentStage,
    };
  }
  if (action === 'get') {
    await getReverseTaskState(store, taskId);
    return {result: 'refreshed task snapshot'};
  }
  if (action === 'summarize') {
    await summarizeReverseTask(store, taskId);
    return {result: 'summarized task snapshot'};
  }
  if (action === 'timeline') {
    await appendReverseTimeline(store, {
      taskId,
      taskSlug:
        typeof step.params.taskSlug === 'string'
          ? step.params.taskSlug
          : undefined,
      targetUrl:
        typeof step.params.targetUrl === 'string'
          ? step.params.targetUrl
          : undefined,
      goal: typeof step.params.goal === 'string' ? step.params.goal : undefined,
      stage: String(step.params.stage ?? currentStage.toLowerCase()),
      action: String(step.params.timelineAction ?? 'orchestrator'),
      status: String(step.params.timelineStatus ?? 'ok'),
      result:
        typeof step.params.result === 'string'
          ? step.params.result
          : 'orchestrated timeline sync',
      next:
        typeof step.params.next === 'string'
          ? step.params.next
          : 'manage_reverse_task:summarize',
    });
    return {result: 'timeline synced'};
  }
  throw new Error(`Unsupported manage_reverse_task action: ${action}`);
};

const overrideAdapter: ExecutionAdapter = async ({
  store,
  taskId,
  currentStage,
  step,
  override,
}) => {
  await appendReverseTimeline(store, {
    taskId,
    stage: currentStage.toLowerCase(),
    action: step.tool,
    status: 'ok',
    result: override?.result ?? `${step.tool} executed by orchestrator`,
    next: 'manage_reverse_task:summarize',
  });
  await syncTaskState(
    store,
    taskId,
    currentStage,
    'active',
    `自动编排已执行 ${step.tool}`,
  );
  return {result: override?.result ?? `${step.tool} executed by orchestrator`};
};

function inferMissingCaps(runtimeError: string): string[] {
  const norm = runtimeError.toLowerCase();
  const caps: string[] = [];
  if (norm.includes('window is not defined') || norm.includes('window')) caps.push('window');
  if (norm.includes('document is not defined') || norm.includes('document')) caps.push('document');
  if (norm.includes('navigator is not defined') || norm.includes('navigator')) caps.push('navigator');
  if (norm.includes('localstorage is not defined')) caps.push('localStorage');
  if (norm.includes('sessionstorage is not defined')) caps.push('sessionStorage');
  if (norm.includes('crypto is not defined') || norm.includes("reading 'subtle'")) caps.push('crypto');
  return caps.length > 0 ? caps : ['unknown'];
}

const exportRebuildBundleAdapter: ExecutionAdapter = async ({
  store,
  taskId,
  currentStage,
}) => {
  const task = await readTaskDescriptor(store, taskId);
  const taskDir = store.getTaskDir(taskId);
  const files = [
    {
      name: 'entry.js',
      content: `import "./env.js";\nimport "./polyfills.js";\nconsole.log("orchestrated rebuild entry");`,
    },
    {
      name: 'env.js',
      content: `globalThis.window = globalThis;\nglobalThis.document ??= {cookie: "", location: {href: ""}};\nglobalThis.navigator ??= {userAgent: "Browser-CLI"};`,
    },
    {
      name: 'polyfills.js',
      content: '',
    },
    {
      name: 'capture.json',
      content: JSON.stringify(
        {
          taskId,
          source: 'orchestrator',
          page: {url: String(task.targetUrl ?? '')},
        },
        null,
        2,
      ),
    },
  ];

  await mkdir(taskDir, {recursive: true});
  for (const file of files) {
    await writeFile(path.join(taskDir, file.name), file.content, 'utf8');
  }

  await appendReverseTimeline(store, {
    taskId,
    stage: currentStage.toLowerCase(),
    action: 'export_rebuild_bundle',
    status: 'ok',
    result: `generated ${files.length} rebuild artifacts`,
    next: 'manage_reverse_task:summarize',
  });
  await syncTaskState(
    store,
    taskId,
    currentStage,
    'active',
    '自动编排已导出本地 rebuild bundle',
  );
  return {result: 'rebuild bundle exported'};
};

const diffEnvRequirementsAdapter: ExecutionAdapter = async ({
  store,
  taskId,
  currentStage,
}) => {
  const runtimeError = await inferRuntimeError(store, taskId);
  const missingCaps = inferMissingCaps(runtimeError);
  const missingCapabilities = missingCaps.join(', ');
  await appendReverseTimeline(store, {
    taskId,
    stage: currentStage.toLowerCase(),
    action: 'diff_env_requirements',
    status: 'ok',
    result: `missing capabilities: ${missingCapabilities}`,
    next: 'manage_reverse_task:summarize',
  });
  await syncTaskState(
    store,
    taskId,
    currentStage,
    'partial',
    `自动编排已分析补环境缺口：${missingCapabilities}`,
  );
  return {result: `missing capabilities: ${missingCapabilities}`};
};

const adapterRegistry: Record<string, ExecutionAdapter> = {
  manage_reverse_task: manageReverseTaskAdapter,
  export_rebuild_bundle: exportRebuildBundleAdapter,
  diff_env_requirements: diffEnvRequirementsAdapter,
};

export async function executeRegisteredStep(
  context: ExecutionAdapterContext,
): Promise<ExecutionAdapterResult> {
  if (context.override?.status === 'ok') {
    return overrideAdapter(context);
  }
  if (context.override?.status === 'error') {
    throw new Error(
      context.override.error ?? `Override for ${context.step.tool} failed`,
    );
  }

  const adapter = adapterRegistry[context.step.tool];
  if (!adapter) {
    throw new Error(
      `Automatic execution for tool "${context.step.tool}" is not implemented yet`,
    );
  }
  return adapter(context);
}
