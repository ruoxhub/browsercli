/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

// Layer definitions matching §3 of 2026-09-04-architecture-master-spec.md
const Layer = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
} as const;

type Layer = (typeof Layer)[keyof typeof Layer];

function getLayer(filePath: string): Layer {
  const norm = filePath.replace(/\\/g, '/');
  if (
    norm.startsWith('src/utils/') ||
    norm.startsWith('src/config/') ||
    norm === 'src/config.ts' ||
    norm.startsWith('src/types/') ||
    norm.startsWith('src/third_party/')
  ) {
    return Layer.L0;
  }
  if (
    norm.startsWith('src/modules/') ||
    norm.startsWith('src/services/') ||
    norm.startsWith('src/formatters/') ||
    norm.startsWith('src/diagnostics/')
  ) {
    return Layer.L1;
  }
  if (
    norm.startsWith('src/worker/') ||
    norm.startsWith('src/reverse/') ||
    norm.startsWith('src/runtime/') ||
    norm === 'src/runtime.ts' ||
    norm === 'src/index.ts'
  ) {
    return Layer.L2;
  }
  if (
    norm.startsWith('src/tools/') ||
    norm.startsWith('src/ipc/') ||
    norm.startsWith('src/cli/')
  ) {
    return Layer.L3;
  }
  return Layer.L1;
}

function getAllSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, {withFileTypes: true});
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = full.replace(/\\/g, '/');
    if (entry.isDirectory()) {
      results.push(...getAllSourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(rel);
    }
  }
  return results;
}

interface ImportEdge {
  from: string;
  to: string;
  isTypeOnly: boolean;
  line: number;
}

function parseImports(filePath: string): ImportEdge[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const edges: ImportEdge[] = [];

  const importRegex =
    /^\s*(import\s+(type\s+)?(?:[\s\S]*?from\s+)?|export\s+(?:type\s+)?[\s\S]*?from\s+)['"]([^'"]+)['"]/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(importRegex);
    if (!match) continue;

    const targetSpecifier = match[3];
    // Only trace local relative imports
    if (!targetSpecifier.startsWith('.')) continue;

    // Resolve target path
    const fileDir = path.dirname(filePath);
    let resolved = path
      .normalize(path.join(fileDir, targetSpecifier))
      .replace(/\\/g, '/');
    if (resolved.endsWith('.js')) {
      resolved = resolved.slice(0, -3) + '.ts';
    } else if (!resolved.endsWith('.ts')) {
      resolved = resolved + '.ts';
    }

    // Determine type-only
    const trimmed = line.trim();
    const isTypeOnly =
      trimmed.startsWith('import type ') ||
      trimmed.startsWith('export type ') ||
      trimmed.startsWith('import type{') ||
      trimmed.startsWith('export type{');

    edges.push({
      from: filePath,
      to: resolved,
      isTypeOnly,
      line: i + 1,
    });
  }

  return edges;
}

// Tarjan's strongly connected components algorithm
function findSCCs(edges: ImportEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.isTypeOnly) continue; // value edges only
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge.to);
  }

  const indexMap = new Map<string, number>();
  const lowlinkMap = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let currentIndex = 0;
  const sccs: string[][] = [];

  function strongConnect(node: string) {
    indexMap.set(node, currentIndex);
    lowlinkMap.set(node, currentIndex);
    currentIndex++;
    stack.push(node);
    onStack.add(node);

    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      if (!indexMap.has(neighbor)) {
        strongConnect(neighbor);
        lowlinkMap.set(
          node,
          Math.min(lowlinkMap.get(node)!, lowlinkMap.get(neighbor)!),
        );
      } else if (onStack.has(neighbor)) {
        lowlinkMap.set(
          node,
          Math.min(lowlinkMap.get(node)!, indexMap.get(neighbor)!),
        );
      }
    }

    if (lowlinkMap.get(node) === indexMap.get(node)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== node);
      if (scc.length > 1) {
        sccs.push(scc);
      }
    }
  }

  for (const node of adj.keys()) {
    if (!indexMap.has(node)) {
      strongConnect(node);
    }
  }

  return sccs;
}

function main() {
  console.log('--- Checking Architecture Layering & Cycles (Phase 1) ---');
  const files = getAllSourceFiles('src');
  console.log(`Scanned ${files.length} source files`);

  const allEdges: ImportEdge[] = [];
  for (const file of files) {
    allEdges.push(...parseImports(file));
  }
  console.log(`Parsed ${allEdges.length} relative import edges`);

  // 1. Check Layer Violations (Rule D1: Downward Only for L0 and L1)
  const l0Violations: ImportEdge[] = [];
  const l1Violations: ImportEdge[] = [];

  for (const edge of allEdges) {
    const sourceLayer = getLayer(edge.from);
    const targetLayer = getLayer(edge.to);

    // Rule D1 for Level 0: L0 cannot import from L1, L2, L3
    if (sourceLayer === Layer.L0 && targetLayer > Layer.L0) {
      l0Violations.push(edge);
    }

    // Rule D1 for Level 1: L1 cannot import from L2, L3
    if (sourceLayer === Layer.L1 && targetLayer > Layer.L1) {
      l1Violations.push(edge);
    }
  }

  let hasError = false;

  console.log('\n[Rule D1: Level 0 Layering Purity]');
  if (l0Violations.length === 0) {
    console.log(
      '  PASS: 0 violations (Level 0 does not import from Level 1, 2, or 3)',
    );
  } else {
    hasError = true;
    console.error(`  FAIL: ${l0Violations.length} violations found:`);
    for (const v of l0Violations) {
      console.error(
        `    ${v.from}:${v.line} -> ${v.to} [${v.isTypeOnly ? 'type' : 'VALUE'}]`,
      );
    }
  }

  console.log('\n[Rule D1: Level 1 Layering Purity]');
  if (l1Violations.length === 0) {
    console.log(
      '  PASS: 0 violations (Level 1 does not import from Level 2 or 3)',
    );
  } else {
    hasError = true;
    console.error(`  FAIL: ${l1Violations.length} violations found:`);
    for (const v of l1Violations) {
      console.error(
        `    ${v.from}:${v.line} -> ${v.to} [${v.isTypeOnly ? 'type' : 'VALUE'}]`,
      );
    }
  }

  // 2. Check Value-only SCCs (Runtime cycles)
  console.log('\n[Rule no-circular: Runtime Value-only Cycles]');
  const sccs = findSCCs(allEdges);

  const unexpectedSCCs: string[][] = [];
  for (const scc of sccs) {
    const isDocumented =
      scc.length === 2 &&
      scc.some(f => f.endsWith('RuntimeConfigStore.ts')) &&
      scc.some(f => f.endsWith('resolver.ts'));

    if (isDocumented) {
      console.log(
        '  INFO: Found documented initialization cycle exception: RuntimeConfigStore.ts <-> resolver.ts (Spec §2.1 & §5.1 Resolution A)',
      );
    } else {
      unexpectedSCCs.push(scc);
    }
  }

  if (unexpectedSCCs.length === 0) {
    console.log('  PASS: 0 unexpected runtime value cycles');
  } else {
    hasError = true;
    console.error(`  FAIL: ${unexpectedSCCs.length} unexpected SCCs found:`);
    for (const scc of unexpectedSCCs) {
      console.error(`    Cycle (${scc.length} files): ${scc.join(' <-> ')}`);
    }
  }

  console.log('\n---------------------------------------------------------');
  if (hasError) {
    console.error('Architecture Check: FAILED');
    process.exit(1);
  } else {
    console.log(
      'Architecture Check: PASSED (All Phase 1 invariants satisfied)',
    );
  }
}

main();
