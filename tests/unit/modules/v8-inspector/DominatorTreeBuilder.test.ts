/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {DominatorTreeBuilder} from '../../../../src/modules/v8-inspector/DominatorTreeBuilder.js';
import type {
  ParsedEdge,
  ParsedNode,
} from '../../../../src/modules/v8-inspector/HeapSnapshotParser.js';

function node(id: number, name: string, selfSize: number): ParsedNode {
  return {id, name, selfSize, type: id === 1 ? 'synthetic' : 'object'};
}

function edge(fromId: number, toId: number): ParsedEdge {
  return {fromId, toId, nameOrIndex: 'child', type: 'property'};
}

function oracleRetainerChain(
  target: number,
  nodeIds: number[],
  edges: ParsedEdge[],
): number[] {
  const predecessors = new Map<number, number[]>();
  for (const nodeId of nodeIds) predecessors.set(nodeId, []);
  for (const item of edges) predecessors.get(item.toId)?.push(item.fromId);

  const all = new Set(nodeIds);
  const dominators = new Map<number, Set<number>>(
    nodeIds.map(nodeId => [nodeId, nodeId === 1 ? new Set([1]) : new Set(all)]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of nodeIds.slice(1)) {
      const incoming = predecessors.get(nodeId) ?? [];
      const intersection = new Set(all);
      for (const predecessor of incoming) {
        const predecessorDominators = dominators.get(predecessor) ?? new Set();
        for (const candidate of intersection) {
          if (!predecessorDominators.has(candidate))
            intersection.delete(candidate);
        }
      }
      intersection.add(nodeId);
      const previous = dominators.get(nodeId) ?? new Set();
      if (
        previous.size !== intersection.size ||
        [...previous].some(candidate => !intersection.has(candidate))
      ) {
        dominators.set(nodeId, intersection);
        changed = true;
      }
    }
  }

  const chain = [target];
  while (chain.at(-1) !== 1) {
    const current = chain.at(-1)!;
    const strictDominators = [...(dominators.get(current) ?? [])].filter(
      candidate => candidate !== current,
    );
    const immediate = strictDominators.toSorted(
      (left, right) =>
        (dominators.get(right)?.size ?? 0) - (dominators.get(left)?.size ?? 0),
    )[0];
    assert.ok(immediate !== undefined);
    chain.push(immediate);
  }
  return chain;
}

describe('DominatorTreeBuilder', () => {
  it('assigns a multiply referenced diamond node to the common dominator', () => {
    const builder = new DominatorTreeBuilder();
    const tree = builder.buildDominatorTree(
      [
        node(1, '(root)', 1),
        node(2, 'left', 2),
        node(3, 'right', 3),
        node(4, 'shared', 4),
      ],
      [edge(1, 2), edge(1, 3), edge(2, 4), edge(3, 4)],
    );

    assert.equal(tree.retainedSize, 10);
    assert.deepEqual(
      tree.children
        .map(child => ({
          nodeId: child.nodeId,
          retainedSize: child.retainedSize,
        }))
        .toSorted((left, right) => left.nodeId - right.nodeId),
      [
        {nodeId: 2, retainedSize: 2},
        {nodeId: 3, retainedSize: 3},
        {nodeId: 4, retainedSize: 4},
      ],
    );
    assert.deepEqual(
      builder.getRetainerChain(4).map(item => item.nodeId),
      [4, 1],
    );
  });

  it('compresses the LT ancestor path without skipping the immediate label', () => {
    const builder = new DominatorTreeBuilder();
    builder.buildDominatorTree(
      [
        node(1, '(root)', 1),
        node(2, 'left', 2),
        node(3, 'join', 3),
        node(4, 'tail', 4),
      ],
      [edge(1, 2), edge(1, 3), edge(2, 3), edge(2, 4), edge(3, 4)],
    );

    assert.deepEqual(
      builder.getRetainerChain(4).map(item => item.nodeId),
      [4, 1],
    );
  });

  it('matches a fixed-point dominator oracle across deterministic small graphs', () => {
    let state = 0x5eed;
    const random = () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };

    for (let sample = 0; sample < 40; sample += 1) {
      const nodeIds = [1, 2, 3, 4, 5, 6];
      const graphEdges = nodeIds.slice(1).map(nodeId => edge(1, nodeId));
      for (const fromId of nodeIds) {
        for (const toId of nodeIds.slice(1)) {
          if (fromId !== toId && random() < 0.3) {
            graphEdges.push(edge(fromId, toId));
          }
        }
      }

      const builder = new DominatorTreeBuilder();
      builder.buildDominatorTree(
        nodeIds.map(nodeId => node(nodeId, `node-${nodeId}`, nodeId)),
        graphEdges,
      );

      for (const nodeId of nodeIds.slice(1)) {
        assert.deepEqual(
          builder.getRetainerChain(nodeId).map(item => item.nodeId),
          oracleRetainerChain(nodeId, nodeIds, graphEdges),
          `sample ${sample}, node ${nodeId}`,
        );
      }
    }
  });

  it('reports detached DOM nodes with their retaining path', () => {
    const builder = new DominatorTreeBuilder();
    const tree = builder.buildDominatorTree(
      [node(1, '(root)', 1), node(2, 'Detached HTMLDivElement', 256)],
      [edge(1, 2)],
    );

    const leak = builder
      .findLeakCandidates(tree, 128)
      .find(candidate => candidate.reason === 'detached-dom');

    assert.ok(leak);
    assert.equal(leak.nodeId, 2);
    assert.equal(leak.confidence, 0.9);
    assert.deepEqual(leak.path, ['(root)', 'Detached HTMLDivElement']);
  });
});
