/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  parseTurboFanJSON,
  parseTurboFanJSONFiles,
} from '../../../../src/modules/v8-inspector/TurboFanGraphParser.js';

function createTurboFanJSON(): string {
  return JSON.stringify({
    function: {
      sourceId: 1,
      functionName: 'hotLoop',
      sourceName: 'fixture.js',
      sourceText: 'function hotLoop(value) { return value + 1; }',
      startPosition: 0,
      endPosition: 46,
    },
    sources: {},
    inlinings: {
      0: {
        inliningId: 7,
        sourceId: 1,
        inliningPosition: {scriptOffset: 12},
      },
    },
    phases: [
      {
        name: 'V8.TFBytecodeGraphBuilder',
        type: 'graph',
        data: {
          nodes: [
            {
              id: 1,
              label: 'Start',
              title: 'Start',
              live: true,
              properties: '',
              opcode: 'Start',
              control: true,
              opinfo: '',
              type: 'control',
            },
            {
              id: 2,
              label: 'Return',
              title: 'Return',
              live: true,
              properties: '',
              opcode: 'Return',
              control: true,
              opinfo: '',
              type: 'control',
            },
          ],
          edges: [
            {source: 1, target: 2, index: 0, type: 'control'},
            {source: 1, target: 2, index: 1, type: 'future-edge-kind'},
          ],
        },
      },
      {name: 'Schedule', type: 'schedule', data: 'B0 -> B1'},
    ],
  });
}

describe('TurboFanGraphParser', () => {
  it('parses phases, graph counts, opcodes, and unknown edge kinds', () => {
    const graph = parseTurboFanJSON(createTurboFanJSON());

    assert.ok(graph);
    assert.equal(graph.function.functionName, 'hotLoop');
    assert.equal(graph.phaseCount, 2);
    assert.equal(graph.totalNodeCount, 2);
    assert.equal(graph.totalEdgeCount, 2);
    assert.deepEqual(graph.opcodeHistogram, {Start: 1, Return: 1});
    assert.equal(graph.phases[0]?.edges?.[0]?.type, 'control');
    assert.equal(graph.phases[0]?.edges?.[1]?.type, 'unknown');
    assert.equal(graph.phases[1]?.data, 'B0 -> B1');
    assert.equal(graph.inlinings['0']?.inliningId, 7);
    assert.equal(
      graph.summary,
      'Function: hotLoop | 2 phases | 2 total nodes | 2 total edges | 1 inlined calls',
    );
  });

  it('skips malformed files while preserving valid graphs', () => {
    const result = parseTurboFanJSONFiles([
      {filename: 'turbo-valid.json', content: createTurboFanJSON()},
      {filename: 'turbo-invalid.json', content: '{invalid'},
    ]);

    assert.equal(result.available, true);
    assert.equal(result.graphCount, 1);
    assert.equal(result.graphs[0]?.function.functionName, 'hotLoop');
    assert.equal(result.reason, 'Parsed 1 TurboFan IR graph(s)');
  });

  it('rejects invalid JSON and missing function metadata', () => {
    assert.equal(parseTurboFanJSON('{invalid'), null);
    assert.equal(parseTurboFanJSON(JSON.stringify({phases: []})), null);
  });
});
