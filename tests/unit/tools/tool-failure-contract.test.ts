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
import {createApiV1Routes} from '../../../src/web/routes/apiV1.js';
import {WsHub} from '../../../src/web/ws/WsHub.js';
import {JobStore} from '../../../src/worker/JobStore.js';
import type {ToolAdapter} from '../../../src/worker/ToolAdapter.js';

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
    const mockToolMeta = {
      name: 'failing_tool',
      description: 'failing tool for contract test',
      schema: {},
      argSpecs: {},
      modulePath: './failing.js',
      handlerName: 'failingTool',
      callMode: 'defineTool' as const,
      domain: 'test',
      profile: 'full' as const,
    };

    const recovery = {
      tool: 'resume',
      command: 'browsercli call resume',
      reason: 'Debugger is paused; resume execution first',
    };
    const details = {pageId: 'page_123', reason: 'paused_at_breakpoint'};

    const mockToolAdapter = {
      executeTool: async () => {
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
      },
    } as unknown as ToolAdapter;

    const routes = createApiV1Routes({
      contextProvider: {
        isBrowserConnected: () => true,
        getContext: () => null,
      } as never,
      toolAdapter: mockToolAdapter,
      jobStore,
      wsHub: new WsHub(),
      getToolMeta: name => (name === mockToolMeta.name ? mockToolMeta : undefined),
      listToolsMeta: () => [mockToolMeta],
      ensureToolsMeta: async () => undefined,
    });

    // 1. Create session
    let sessionResBody = '';
    const sessionRes = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      end(payload: string) {
        sessionResBody = payload;
      },
    };
    await routes.get('POST /api/v1/sessions')!({} as never, sessionRes as never);
    const sessionId = JSON.parse(sessionResBody).data.sessionId;

    // 2. Invoke tool
    let invokeResBody = '';
    const invokeRes = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      end(payload: string) {
        invokeResBody = payload;
      },
    };

    const reqMock = {
      on(event: string, cb: (data?: unknown) => void) {
        if (event === 'data') {
          cb(Buffer.from(JSON.stringify({tool: 'failing_tool', params: {}})));
        }
        if (event === 'end') {
          cb();
        }
        return this;
      },
    };

    await routes.get('POST /api/v1/sessions/:id/invoke')!(
      reqMock as never,
      invokeRes as never,
      {id: sessionId},
    );

    const jobId = JSON.parse(invokeResBody).data.jobId;
    assert.ok(jobId);

    // Wait for job to fail
    for (let i = 0; i < 50; i++) {
      const job = jobStore.get(jobId);
      if (job.status === 'failed') break;
      await new Promise(r => setTimeout(r, 5));
    }

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
