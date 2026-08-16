/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {HeapSnapshotParser} from '../../../../src/modules/v8-inspector/HeapSnapshotParser.js';

function createStandardSnapshot(): string {
  return JSON.stringify({
    snapshot: {
      meta: {
        node_fields: [
          'type',
          'name',
          'id',
          'self_size',
          'edge_count',
          'trace_node_id',
          'detachedness',
        ],
        node_types: [
          [
            'hidden',
            'array',
            'string',
            'object',
            'code',
            'closure',
            'regexp',
            'number',
            'native',
            'synthetic',
          ],
        ],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [
          [
            'context',
            'element',
            'property',
            'internal',
            'hidden',
            'shortcut',
            'weak',
          ],
        ],
      },
    },
    nodes: [9, 0, 1, 10, 1, 0, 0, 3, 1, 2, 20, 0, 0, 0],
    edges: [2, 2, 7],
    strings: ['(root)', 'Widget', 'child'],
  });
}

describe('HeapSnapshotParser', () => {
  it('reassembles streamed standard snapshots without corrupting JSON', () => {
    const snapshot = createStandardSnapshot();
    const splitAt = Math.floor(snapshot.length / 2);
    const parser = new HeapSnapshotParser();

    parser.feedChunk([snapshot.slice(0, splitAt), snapshot.slice(splitAt)]);

    assert.deepEqual(parser.parseNodes(), [
      {id: 1, name: '(root)', selfSize: 10, type: 'synthetic'},
      {id: 2, name: 'Widget', selfSize: 20, type: 'object'},
    ]);
    assert.deepEqual(parser.parseEdges(), [
      {fromId: 1, toId: 2, nameOrIndex: 'child', type: 'property'},
    ]);
    assert.deepEqual(parser.getAllRetainedSizes(), [
      {id: 1, retainedSize: 30},
      {id: 2, retainedSize: 20},
    ]);
  });

  it('exports summaries and analyzes class statistics from literal data', async () => {
    const parser = new HeapSnapshotParser(createStandardSnapshot());

    assert.deepEqual(parser.exportSummary(), {
      totalNodes: 2,
      totalEdges: 1,
      totalSize: 30,
      topRetainers: [
        {name: 'Widget', retainedSize: 20, count: 1},
        {name: '(root)', retainedSize: 10, count: 1},
      ],
    });

    const analysis = await parser.analyzeHeap('snapshot-1', {
      includeDominatorTree: true,
      dominatorTreeDepth: 1,
    });
    assert.equal(analysis.metadata.snapshotId, 'snapshot-1');
    assert.equal(analysis.statistics.totalObjects, 2);
    assert.equal(analysis.statistics.totalShallowSize, 30);
    assert.deepEqual(analysis.classHistogram, [
      {className: 'Widget', count: 1, shallowSize: 20, retainedSize: 20},
      {className: '(root)', count: 1, shallowSize: 10, retainedSize: 10},
    ]);
    assert.equal(analysis.dominatorTree?.retainedSize, 30);
    assert.deepEqual(analysis.dominatorTree?.children, [
      {
        nodeId: 2,
        name: 'Widget',
        retainedSize: 20,
        shallowSize: 20,
        children: [],
      },
    ]);
  });

  it('returns empty results for malformed input instead of throwing', () => {
    const parser = new HeapSnapshotParser('{not-json');

    assert.deepEqual(parser.parseNodes(), []);
    assert.deepEqual(parser.parseEdges(), []);
    assert.deepEqual(parser.exportSummary(), {
      totalNodes: 0,
      totalEdges: 0,
      totalSize: 0,
      topRetainers: [],
    });
  });
});
