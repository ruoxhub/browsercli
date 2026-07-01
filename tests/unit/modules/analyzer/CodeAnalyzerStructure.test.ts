/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import * as parser from '@babel/parser';
import type * as t from '@babel/types';

import {
  analyzeModules,
  analyzeStructure,
  buildCallGraph,
  calculateComplexity,
} from '../../../../src/modules/analyzer/CodeAnalyzerStructure.js';
import type {FunctionInfo} from '../../../../src/types/index.js';

function parseAst(code: string): t.File {
  return parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });
}

function mockFunctionInfo(name: string): FunctionInfo {
  return {
    name,
    params: [],
    location: {file: 'test', line: 1, column: 0},
    complexity: 1,
  };
}

describe('calculateComplexity', () => {
  it('returns 1 for empty function (no branch visitors fire)', () => {
    // Mock path whose traverse never invokes any visitor handlers.
    const mockPath = {traverse: () => {}};
    assert.strictEqual(calculateComplexity(mockPath), 1);
  });

  it('increments for if statements', () => {
    const visitors: Record<string, () => void> = {};
    const mockPath = {
      traverse: (handlers: Record<string, () => void>) => {
        Object.assign(visitors, handlers);
        visitors.IfStatement?.();
      },
    };
    assert.strictEqual(calculateComplexity(mockPath), 2);
  });

  it('increments for for/while loops', () => {
    const visitors: Record<string, () => void> = {};
    const mockPath = {
      traverse: (handlers: Record<string, () => void>) => {
        Object.assign(visitors, handlers);
        visitors.ForStatement?.();
        visitors.WhileStatement?.();
      },
    };
    assert.strictEqual(calculateComplexity(mockPath), 3);
  });

  it('increments for switch case, catch clause, and conditional', () => {
    const visitors: Record<string, () => void> = {};
    const mockPath = {
      traverse: (handlers: Record<string, () => void>) => {
        Object.assign(visitors, handlers);
        visitors.SwitchCase?.();
        visitors.CatchClause?.();
        visitors.ConditionalExpression?.();
      },
    };
    assert.strictEqual(calculateComplexity(mockPath), 4);
  });
});

describe('buildCallGraph', () => {
  it('detects direct function calls', () => {
    const ast = parseAst(`function a() {} function b() { a(); }`);
    const functions = [mockFunctionInfo('a'), mockFunctionInfo('b')];
    const graph = buildCallGraph(functions, ast);
    assert.ok(graph.edges.some(e => e.from === 'b' && e.to === 'a'));
    assert.strictEqual(graph.nodes.length, 2);
  });

  it('returns empty edges when no calls are made', () => {
    const ast = parseAst(`function a() {} function b() {}`);
    const functions = [mockFunctionInfo('a'), mockFunctionInfo('b')];
    const graph = buildCallGraph(functions, ast);
    assert.strictEqual(graph.edges.length, 0);
    assert.strictEqual(graph.nodes.length, 2);
  });
});

describe('analyzeStructure', () => {
  it('returns structure with functions array for simple code', async () => {
    const code = `function foo(x) { return x; }`;
    const ast = parseAst(code);
    const result = await analyzeStructure(code, ast);
    assert.ok(Array.isArray(result.functions));
    assert.ok(result.functions.some(f => f.name === 'foo'));
    assert.ok(Array.isArray(result.classes));
    assert.ok(Array.isArray(result.modules));
    assert.ok(result.callGraph);
  });

  it('detects arrow functions and classes', async () => {
    const code = `const arrow = () => 1;\nclass C { m() {} }`;
    const ast = parseAst(code);
    const result = await analyzeStructure(code, ast);
    assert.ok(result.functions.some(f => f.name === 'arrow'));
    assert.ok(result.classes.some(c => c.name === 'C'));
  });
});

describe('analyzeModules', () => {
  it('detects imports and exports', () => {
    const code = `import a from 'mod-a';\nexport default function f() {}`;
    const ast = parseAst(code);
    const modules = analyzeModules(code, ast);
    assert.ok(modules.length > 0);
    assert.ok(modules[0].imports.includes('mod-a'));
    assert.ok(modules[0].exports.includes('default'));
  });
});
