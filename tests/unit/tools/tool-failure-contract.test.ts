/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';

import {createToolError, ErrorCodes} from '../../../src/utils/errors.js';
import type {ToolError} from '../../../src/utils/errors.js';
import {JobStore} from '../../../src/worker/JobStore.js';

/**
 * Job 错误包装契约（原 HTTP 路由 runJob 的语义，现由 daemonServer 沿用）：
 * ToolError 抛错时按 code/message/retryable/recovery/details 结构化落盘。
 */
async function runJobOnce(
  jobStore: JobStore,
  execute: () => Promise<unknown>,
): Promise<string> {
  const job = jobStore.create('s1', 'failing_tool', {});
  jobStore.markRunning(job.jobId);
  try {
    jobStore.complete(job.jobId, await execute());
  } catch (error) {
    const e = error as Partial<ToolError>;
    jobStore.fail(job.jobId, {
      code: e.code ?? ErrorCodes.RUNTIME,
      message: e.message ?? String(error),
      ...(e.retryable !== undefined ? {retryable: e.retryable} : {}),
      ...(e.recovery !== undefined ? {recovery: e.recovery} : {}),
      ...(e.details !== undefined ? {details: e.details} : {}),
    });
  }
  return job.jobId;
}

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Tool Failure Contract & Job Failed Guarantee', () => {
  it('statically guarantees zero prohibited failure-return shapes in tool implementations', () => {
    const toolsDir = path.resolve(process.cwd(), 'src/tools');
    const sourceFiles = collectSourceFiles(toolsDir);
    const violations: Array<{file: string; match: string}> = [];

    // Files that are allowed to define success type properties or helpers, if any (must be strictly justified)
    const allowedExemptions = new Set<string>([
      // No exemptions in end state
    ]);

    const prohibitedPatterns = [
      /\bsuccess\s*:\s*false\b/,
      /\bisError\s*:\s*true\b/,
    ];

    for (const file of sourceFiles) {
      const relPath = path.relative(toolsDir, file).replace(/\\/g, '/');
      if (allowedExemptions.has(relPath)) continue;

      const content = readFileSync(file, 'utf-8');
      for (const pattern of prohibitedPatterns) {
        if (pattern.test(content)) {
          violations.push({file: relPath, match: pattern.source});
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found ${violations.length} files with prohibited failure return shapes:\n` +
        violations.map(v => `  - ${v.file} (matched ${v.match})`).join('\n'),
    );
  });

  it('ensures Job transitions to failed with all structured ToolError details when handler throws', async () => {
    const jobStore = new JobStore();

    const recovery = {
      tool: 'resume',
      command: 'browsercli call resume',
      reason: 'Debugger is paused; resume execution first',
    };
    const details = {pageId: 'page_123', reason: 'paused_at_breakpoint'};

    const jobId = await runJobOnce(jobStore, async () => {
      throw createToolError(
        ErrorCodes.DEBUGGER_PAUSED,
        'Page execution is paused at breakpoint',
        {toolName: 'failing_tool'},
        {
          retryable: true,
          recovery,
          details,
        },
      );
    });

    const failedJob = jobStore.get(jobId);
    assert.equal(failedJob.status, 'failed');
    assert.equal(failedJob.result, undefined);
    assert.deepEqual(failedJob.error, {
      code: 'DEBUGGER_PAUSED',
      message: 'Page execution is paused at breakpoint',
      retryable: true,
      recovery,
      details,
    });
  });
});
