/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it, after} from 'node:test';

import {ReverseTaskStore} from '../../../src/reverse/ReverseTaskStore.js';
import {getRuntime} from '../../../src/runtime.js';
import {record_reverse_evidence} from '../../../src/tools/analyzer/reports.js';
import {getHookData} from '../../../src/tools/hook/index.js';
import type {CollectCodeResult} from '../../../src/types/index.js';
import {DetailedDataManager} from '../../../src/utils/detailedDataManager.js';

interface ResponseShape {
  lines: string[];
  structuredContent?: unknown;
  appendResponseLine(value: string): void;
  setStructuredContent(content: unknown): void;
}

function makeResponse(): ResponseShape {
  const lines: string[] = [];
  let structuredContent: unknown = undefined;
  return {
    lines,
    get structuredContent() {
      return structuredContent;
    },
    appendResponseLine: (value: string) => {
      lines.push(value);
    },
    setStructuredContent: (content: unknown) => {
      structuredContent = content;
      if (
        content &&
        typeof content === 'object' &&
        'success' in content &&
        content.success === false
      ) {
        console.error(
          'DEBUG setStructuredContent failure:',
          JSON.stringify(content),
        );
      }
      lines.push('```json');
      const payload =
        content &&
        typeof content === 'object' &&
        'data' in content &&
        content.data
          ? content.data
          : content;
      lines.push(JSON.stringify(payload, null, 2));
      lines.push('```');
    },
  };
}

function extractFirstJsonBlock(lines: string[]): Record<string, unknown> {
  const start = lines.indexOf('```json');
  const end = lines.indexOf('```', start + 1);
  return JSON.parse(lines.slice(start + 1, end).join('\n')) as Record<
    string,
    unknown
  >;
}

describe('reverse task tools', () => {
  it('mirrors runtime evidence into network and scripts artifacts and removes template placeholders', async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), 'js-reverse-task-mirror-'),
    );
    const runtime = getRuntime();
    const originalStore = runtime.reverseTaskStore;

    runtime.reverseTaskStore = new ReverseTaskStore({rootDir});

    try {
      const taskDir = path.join(rootDir, 'task-mirror');
      await mkdir(taskDir, {recursive: true});
      await writeFile(
        path.join(taskDir, 'network.jsonl'),
        '{"ts":"<ISO8601>","request":{"url":"<url>"}}\n',
        'utf8',
      );
      await writeFile(
        path.join(taskDir, 'scripts.jsonl'),
        '{"ts":"<ISO8601>","url":"<script_url>"}\n',
        'utf8',
      );

      const networkResponse = makeResponse();
      await record_reverse_evidence.handler(
        {
          params: {
            taskId: 'task-mirror',
            taskSlug: 'demo',
            targetUrl: 'https://example.com',
            goal: 'mirror capture',
            channel: 'runtime-evidence',
            entry: {
              ts: '2026-03-07T12:00:00Z',
              stage: 'capture',
              source: 'mcp',
              request: {
                method: 'GET',
                url: 'https://example.com/api/sign?token=abc',
                queryKeys: ['token', 'sign'],
              },
              response: {
                status: 200,
                bodyPreview: '{"ok":true}',
              },
              note: 'captured request',
            },
          },
        } as Parameters<typeof record_reverse_evidence.handler>[0],
        networkResponse as unknown as Parameters<
          typeof record_reverse_evidence.handler
        >[1],
        {} as Parameters<typeof record_reverse_evidence.handler>[2],
      );

      const scriptResponse = makeResponse();
      await record_reverse_evidence.handler(
        {
          params: {
            taskId: 'task-mirror',
            taskSlug: 'demo',
            targetUrl: 'https://example.com',
            goal: 'mirror capture',
            channel: 'runtime-evidence',
            entry: {
              ts: '2026-03-07T12:00:01Z',
              source: 'mcp',
              scriptId: '77',
              url: 'https://cdn.example.com/security.js',
              locator: {type: 'find_in_script', query: 'sign', offset: '10'},
              note: 'candidate sign chain',
            },
          },
        } as Parameters<typeof record_reverse_evidence.handler>[0],
        scriptResponse as unknown as Parameters<
          typeof record_reverse_evidence.handler
        >[1],
        {} as Parameters<typeof record_reverse_evidence.handler>[2],
      );

      const network = (
        await readFile(path.join(taskDir, 'network.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));
      const scripts = (
        await readFile(path.join(taskDir, 'scripts.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));

      assert.strictEqual(network.length, 1);
      assert.strictEqual(
        network[0].request.url,
        'https://example.com/api/sign?token=abc',
      );
      assert.strictEqual(network[0].response.status, 200);
      assert.strictEqual(network[0].note, 'captured request');

      assert.strictEqual(scripts.length, 1);
      assert.strictEqual(scripts[0].scriptId, '77');
      assert.strictEqual(scripts[0].url, 'https://cdn.example.com/security.js');
      assert.strictEqual(scripts[0].note, 'candidate sign chain');
    } finally {
      runtime.reverseTaskStore = originalStore;
      await rm(rootDir, {recursive: true, force: true});
    }
  });

  it('records reverse evidence and emits rebuild-oriented guidance', async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), 'js-reverse-task-tools-'),
    );
    const runtime = getRuntime();
    const originals = {
      reverseTaskStore: runtime.reverseTaskStore,
      collectorCollect: runtime.collector.collect,
      hookCreate: runtime.hookManager.create,
      hookRecords: runtime.hookManager.getRecords,
      replayActions: runtime.pageController.replayActions,
    };

    runtime.reverseTaskStore = new ReverseTaskStore({rootDir});
    runtime.collector.collect = async (): Promise<CollectCodeResult> => ({
      files: [
        {
          url: 'app.js',
          content: 'function sign(){return 1}',
          size: 32,
          type: 'external',
        },
      ],
      dependencies: {nodes: [], edges: []},
      totalSize: 32,
      collectTime: 1,
    });
    runtime.hookManager.create = ({type}: {type: string}) => ({
      hookId: `${type}-hook-1`,
      type,
      script: `/* ${type} */`,
    });
    runtime.hookManager.getRecords = () => [
      {
        hookId: 'fetch-hook-1',
        target: 'fetch',
        event: 'request',
        method: 'POST',
        url: 'https://example.com/api/sign?token=abc',
        body: '{"token":"abc","sign":"xyz"}',
        status: 200,
        timestamp: Date.now(),
      },
    ];
    runtime.pageController.replayActions = async () => [];

    try {
      const recordResponse = makeResponse();
      await record_reverse_evidence.handler(
        {
          params: {
            taskId: 'task-001',
            taskSlug: 'demo',
            targetUrl: 'https://example.com',
            goal: 'rebuild signature',
            channel: 'runtime-evidence',
            targetKeywords: ['sign', 'nonce'],
            targetUrlPatterns: ['https://example.com/api/sign'],
            targetFunctionNames: ['signPayload'],
            targetActionDescription: 'click submit order button',
            entry: {
              source: 'hook',
              note: 'captured sign parameters',
            },
          },
        } as Parameters<typeof record_reverse_evidence.handler>[0],
        recordResponse as unknown as Parameters<
          typeof record_reverse_evidence.handler
        >[1],
        {} as Parameters<typeof record_reverse_evidence.handler>[2],
      );

      const recorded = (
        await readFile(
          path.join(rootDir, 'task-001', 'runtime-evidence.jsonl'),
          'utf8',
        )
      )
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));
      assert.strictEqual(recorded.length, 1);
      assert.strictEqual(recorded[0].source, 'hook');
      assert.strictEqual(recorded[0].note, 'captured sign parameters');
      assert.deepStrictEqual(recorded[0].targetContext, {
        targetKeywords: ['sign', 'nonce'],
        targetUrlPatterns: ['https://example.com/api/sign'],
        targetFunctionNames: ['signPayload'],
        targetActionDescription: 'click submit order button',
      });

      const targetContext = JSON.parse(
        await readFile(
          path.join(rootDir, 'task-001', 'target-context.json'),
          'utf8',
        ),
      ) as Record<string, unknown>;
      assert.deepStrictEqual(targetContext, {
        targetKeywords: ['sign', 'nonce'],
        targetUrlPatterns: ['https://example.com/api/sign'],
        targetFunctionNames: ['signPayload'],
        targetActionDescription: 'click submit order button',
      });

      const hookResponse = makeResponse();
      await getHookData.handler(
        {
          params: {
            hookId: 'fetch-hook-1',
            view: 'detail',
            maxRecords: 5,
          },
        } as Parameters<typeof getHookData.handler>[0],
        hookResponse as unknown as Parameters<typeof getHookData.handler>[1],
        {} as Parameters<typeof getHookData.handler>[2],
      );
      const hookJson = extractFirstJsonBlock(hookResponse.lines);
      assert.ok(Array.isArray(hookJson.candidateEnvNeeds));
      assert.ok(Array.isArray(hookJson.requestBindings));
    } finally {
      runtime.reverseTaskStore = originals.reverseTaskStore;
      runtime.collector.collect = originals.collectorCollect;
      runtime.hookManager.create = originals.hookCreate;
      runtime.hookManager.getRecords = originals.hookRecords;
      runtime.pageController.replayActions = originals.replayActions;
      await rm(rootDir, {recursive: true, force: true});
    }
  });

  // 清理定时器，允许测试进程退出
  after(() => {
    DetailedDataManager.destroy();
  });
});
