/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import type {Frame} from 'patchright';

import {ToolCategory} from '../../../../src/tools/categories.js';
import {extractTable} from '../../../../src/tools/data/extractTable.js';
import {manifest as dataManifest} from '../../../../src/tools/data/manifest.js';
import type {
  ExtractedTable,
  RawTableCapture,
  RawTableCell,
  RawTableSource,
} from '../../../../src/tools/data/types.js';
import {GENERATED_DOMAIN_MANIFESTS} from '../../../../src/tools/generated-tools-index.js';
import {ToolRegistry} from '../../../../src/tools/registry/ToolRegistry.js';
import {loadToolMeta} from '../../../../src/tools/tools-meta.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';

interface CdpCall {
  method: string;
  params?: Record<string, unknown>;
}

interface FakeHarness {
  frame: Frame;
  calls: CdpCall[];
}

type HarnessOptions =
  | {capture: RawTableCapture}
  | {failure: {reason: string; message: string}}
  | {evaluateError: Error};

/**
 * Minimal fake Frame/CDP: `Runtime.evaluate` returns the serialized collector
 * result directly, so the real `captureTable` (frameId resolution, isolated
 * world, failure mapping, detach) runs unmodified. The page-side collector
 * algorithm itself is covered by extractTablePage.test.ts.
 */
function createFakeFrame(
  options: HarnessOptions,
  {wrapFrame = false}: {wrapFrame?: boolean} = {},
): FakeHarness {
  const calls: CdpCall[] = [];

  const createSession = () => ({
    send: async (method: string, params?: Record<string, unknown>) => {
      calls.push({method, params});
      if (method === 'Page.getFrameTree') {
        return {frameTree: {frame: {id: 'frame-root'}}};
      }
      if (method === 'Page.createIsolatedWorld') {
        return {executionContextId: 42};
      }
      if (method === 'Runtime.evaluate') {
        if ('evaluateError' in options) throw options.evaluateError;
        const value = 'failure' in options ? options.failure : options.capture;
        // CDP `returnByValue` serializes the remote value before it arrives.
        return {result: {value: JSON.parse(JSON.stringify(value))}};
      }
      throw new Error(`unexpected CDP method: ${method}`);
    },
    detach: async () => undefined,
  });

  const page = {
    url: () => 'https://example.test/page',
    // `page.frames()` always yields the raw frames; only the frame handed to
    // the tool may be the worker's Proxy wrapper.
    frames: () => [rawFrame],
    context: () => ({newCDPSession: async () => createSession()}),
  };
  const rawFrame = {page: () => page, _guid: 'frame@abc'} as unknown as Frame;
  // Worker mode wraps every frame in this Proxy (frame.evaluate timeout guard),
  // which breaks identity comparison against `page.frames()`.
  const frame = wrapFrame
    ? (new Proxy(rawFrame, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as Frame)
    : rawFrame;

  return {frame, calls};
}

function captureResponse() {
  let content: any = null;
  return {
    response: {
      setStructuredContent(value: unknown) {
        content = value;
      },
    },
    get content() {
      return content;
    },
  };
}

function createContext(frame: Frame | null) {
  return {getSelectedFrame: () => frame} as any;
}

const source: RawTableSource = {
  pageUrl: 'https://example.test/page',
  frameUrl: 'https://example.test/frame',
  title: 'Fixture page',
  selector: '#grid',
};

function cell(text: string, overrides: Partial<RawTableCell> = {}) {
  return {
    text,
    header: false,
    rowSpan: 1,
    colSpan: 1,
    headers: [],
    scope: '',
    id: '',
    ...overrides,
  } satisfies RawTableCell;
}

/** 2 columns, 2 data rows; the first data cell spans 2 rows. */
const rawCapture: RawTableCapture = {
  source,
  rows: [
    {
      kind: 'header',
      cells: [cell('Name', {header: true}), cell('Score', {header: true})],
    },
    {kind: 'data', cells: [cell('Ann', {rowSpan: 2}), cell('9')]},
    {kind: 'data', cells: [cell('10')]},
  ],
};

const expectedTable: ExtractedTable = {
  schemaVersion: 1,
  kind: 'table',
  source,
  columns: [
    {key: 'c1', name: 'Name', headerPath: ['Name']},
    {key: 'c2', name: 'Score', headerPath: ['Score']},
  ],
  rows: [
    {c1: 'Ann', c2: '9'},
    {c1: null, c2: '10'},
  ],
  spans: [{columnKey: 'c1', section: 'data', row: 0, rowSpan: 2, colSpan: 1}],
  coverage: {rowsReturned: 2, datasetComplete: 'unknown'},
  warnings: [],
};

const expectedCsv = 'Name,Score\r\nAnn,9\r\n,10';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'extract-table-'));
});

afterEach(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

async function runExtractTable(
  params: Record<string, unknown>,
  options: HarnessOptions,
) {
  const harness = createFakeFrame(options);
  const output = captureResponse();
  await extractTable.handler(
    {params} as any,
    output.response as any,
    createContext(harness.frame),
  );
  assert.ok(output.content, 'handler must set structured content');
  return {calls: harness.calls, content: output.content};
}

describe('extract_table JSON payload', () => {
  it('resolves the frameId through the worker proxy wrapper', async () => {
    // Regression: the worker hands tools a Proxy-wrapped Frame, so
    // `page.frames().indexOf(frame)` misses and capture never starts.
    const harness = createFakeFrame({capture: rawCapture}, {wrapFrame: true});
    const output = captureResponse();

    await extractTable.handler(
      {params: {selector: '#grid'}} as any,
      output.response as any,
      createContext(harness.frame),
    );

    assert.deepEqual(output.content.data, expectedTable);
  });

  it('returns the normalized table without a CSV copy', async () => {
    const {content} = await runExtractTable(
      {selector: '#grid'},
      {capture: rawCapture},
    );

    assert.equal(content.success, true);
    assert.equal(content.tooltype, 'extract_table');
    assert.equal(typeof content.message, 'string');
    assert.deepEqual(content.data, expectedTable);
    assert.equal(content.data.outputPath, undefined);
    assert.ok(!JSON.stringify(content).includes(expectedCsv));
  });

  it('keeps the normalized shape when includeHidden widens collection', async () => {
    const {calls, content} = await runExtractTable(
      {selector: '#grid', includeHidden: true},
      {capture: rawCapture},
    );

    const evaluate = calls.find(call => call.method === 'Runtime.evaluate');
    const expression = String(evaluate?.params?.['expression']);
    assert.ok(
      expression.includes('"includeHidden":true'),
      'includeHidden must reach the collector',
    );
    assert.deepEqual(content.data, expectedTable);
  });

  it('passes includeHidden: false to the collector by default', async () => {
    const {calls} = await runExtractTable(
      {selector: '#grid'},
      {capture: rawCapture},
    );

    const evaluate = calls.find(call => call.method === 'Runtime.evaluate');
    assert.ok(
      String(evaluate?.params?.['expression']).includes(
        '"includeHidden":false',
      ),
    );
  });
});

describe('extract_table file output', () => {
  it('rejects format csv without outputPath', async () => {
    const harness = createFakeFrame({capture: rawCapture});
    const output = captureResponse();

    await assert.rejects(
      () =>
        extractTable.handler(
          {params: {selector: '#grid', format: 'csv'}} as any,
          output.response as any,
          createContext(harness.frame),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.VALIDATION);
        return true;
      },
    );

    // Rejected before touching the browser.
    assert.equal(harness.calls.length, 0);
  });

  it('writes the exact UTF-8 CSV and still returns rows and spans', async () => {
    const outputPath = path.join(tempDir, 'nested', 'table.csv');

    const {content} = await runExtractTable(
      {selector: '#grid', format: 'csv', outputPath},
      {capture: rawCapture},
    );

    const written = await readFile(outputPath);
    assert.deepEqual(written, Buffer.from(expectedCsv, 'utf8'));
    assert.equal(content.data.outputPath, outputPath);
    assert.deepEqual(content.data.rows, expectedTable.rows);
    assert.deepEqual(content.data.spans, expectedTable.spans);
    assert.equal(content.data.csv, undefined);
  });

  it('writes parseable canonical JSON', async () => {
    const outputPath = path.join(tempDir, 'nested', 'table.json');

    const {content} = await runExtractTable(
      {selector: '#grid', format: 'json', outputPath},
      {capture: rawCapture},
    );

    const written = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.deepEqual(written, expectedTable);
    assert.equal(content.data.outputPath, outputPath);
  });
});

describe('extract_table capture failures', () => {
  const cases = [
    {reason: 'not_found', code: ErrorCodes.NOT_FOUND},
    {reason: 'ambiguous', code: ErrorCodes.VALIDATION},
    {reason: 'not_a_table', code: ErrorCodes.VALIDATION},
    {reason: 'hidden', code: ErrorCodes.VALIDATION},
    {reason: 'bad_selector', code: ErrorCodes.VALIDATION},
  ];

  for (const testCase of cases) {
    it(`maps ${testCase.reason} to ${testCase.code}`, async () => {
      const harness = createFakeFrame({
        failure: {
          reason: testCase.reason,
          message: `collector said ${testCase.reason}`,
        },
      });
      const output = captureResponse();

      await assert.rejects(
        () =>
          extractTable.handler(
            {params: {selector: '#grid'}} as any,
            output.response as any,
            createContext(harness.frame),
          ),
        (error: unknown) => {
          assert.ok(error instanceof ToolError);
          assert.equal(error.code, testCase.code);
          assert.match(error.message, new RegExp(testCase.reason));
          return true;
        },
      );
    });
  }

  it('maps an unexpected CDP failure to RUNTIME', async () => {
    const harness = createFakeFrame({
      evaluateError: new Error('CDP runtime blew up'),
    });
    const output = captureResponse();

    await assert.rejects(
      () =>
        extractTable.handler(
          {params: {selector: '#grid'}} as any,
          output.response as any,
          createContext(harness.frame),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.RUNTIME);
        return true;
      },
    );
  });

  it('requires a selected frame', async () => {
    await assert.rejects(
      () =>
        extractTable.handler(
          {params: {selector: '#grid'}} as any,
          captureResponse().response as any,
          createContext(null),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.FRAME_REQUIRED);
        return true;
      },
    );
  });
});

describe('extract_table registration', () => {
  it('is annotated as a data tool that may write files', () => {
    assert.equal(extractTable.name, 'extract_table');
    assert.equal(extractTable.annotations.category, ToolCategory.DATA);
    assert.equal(extractTable.annotations.readOnlyHint, false);
  });

  it('is registered by the data manifest as a full-profile tool', () => {
    assert.equal(dataManifest.name, 'data');
    assert.equal(dataManifest.profile, 'full');
    assert.deepEqual(dataManifest.tools, [
      {modulePath: './data/extractTable.js', handlerName: 'extractTable'},
    ]);
  });

  it('is discoverable in the full profile with introspectable args', async () => {
    const registry = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS);
    const entry = registry
      .listTools('full')
      .find(
        tool => tool.domain === 'data' && tool.handlerName === 'extractTable',
      );
    assert.ok(entry, 'extractTable is missing from the generated index');
    assert.equal(entry.profile, 'full');

    const meta = await loadToolMeta(entry);
    assert.ok(meta, 'extract_table failed to load to ToolMeta');
    assert.equal(meta.name, 'extract_table');
    assert.equal(meta.argSpecs.selector.required, true);
    assert.equal(meta.argSpecs.selector.type, 'string');
    assert.deepEqual(meta.argSpecs.format.enum, ['json', 'csv']);
    assert.equal(meta.argSpecs.format.required, false);
    assert.equal(meta.argSpecs.outputPath.type, 'string');
    assert.equal(meta.argSpecs.includeHidden.type, 'boolean');
  });
});
