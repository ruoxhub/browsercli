/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * CodeAnalyzer 结构分析策略模块。
 * 提取自 CodeAnalyzer.ts 的 AST 遍历与分析逻辑。
 */

import traverseImport from '@babel/traverse';
const traverse =
  (traverseImport as unknown as {default?: typeof traverseImport}).default ??
  traverseImport;
import type * as t from '@babel/types';

import type {
  FunctionInfo,
  ClassInfo,
  CallGraph,
  CodeStructure,
} from '../../types/index.js';

/**
 * 分析代码的模块结构（imports / exports）。
 * 提取自 CodeAnalyzer.ts L352–L386。
 */
export function analyzeModules(
  code: string,
  ast: t.File | null,
): CodeStructure['modules'] {
  const modules: CodeStructure['modules'] = [];

  if (ast) {
    const imports: string[] = [];
    const exports: string[] = [];

    traverse(ast, {
      ImportDeclaration(path) {
        imports.push(path.node.source.value);
      },
      ExportNamedDeclaration(path) {
        if (path.node.source) {
          exports.push(path.node.source.value);
        }
      },
      ExportDefaultDeclaration() {
        exports.push('default');
      },
    });

    if (imports.length > 0 || exports.length > 0) {
      modules.push({
        name: 'current',
        imports,
        exports,
      });
    }
  }

  return modules;
}

/**
 * 计算节点的圈复杂度。
 * 提取自 CodeAnalyzer.ts L451–L492。
 */
export function calculateComplexity(path: unknown): number {
  let complexity = 1;

  // 使用any类型绕过类型检查
  const anyPath = path as any;

  if (anyPath.traverse) {
    anyPath.traverse({
      IfStatement() {
        complexity++;
      },
      SwitchCase() {
        complexity++;
      },
      ForStatement() {
        complexity++;
      },
      WhileStatement() {
        complexity++;
      },
      DoWhileStatement() {
        complexity++;
      },
      ConditionalExpression() {
        complexity++;
      },
      LogicalExpression(logicalPath: any) {
        if (
          logicalPath.node.operator === '&&' ||
          logicalPath.node.operator === '||'
        ) {
          complexity++;
        }
      },
      CatchClause() {
        complexity++;
      },
    });
  }

  return complexity;
}

/**
 * 构建函数调用图。
 * 提取自 CodeAnalyzer.ts L388–L449。
 *
 * 注意：原始签名包含 `code` 参数并会 fallback 调用 `this.parseCodeAst`。
 * 现已移除 `code` 参数，`ast` 改为必传 —— caller 需保证传入有效的 ast。
 */
export function buildCallGraph(
  functions: FunctionInfo[],
  ast: t.File | null,
): CallGraph {
  const nodes: CallGraph['nodes'] = functions.map(fn => ({
    id: fn.name,
    name: fn.name,
    type: 'function' as const,
  }));

  const edges: CallGraph['edges'] = [];

  if (ast) {
    let currentFunction = '';

    traverse(ast, {
      FunctionDeclaration(path) {
        currentFunction = path.node.id?.name || '';
      },
      FunctionExpression(path) {
        const parent = path.parent;
        if (
          parent.type === 'VariableDeclarator' &&
          parent.id.type === 'Identifier'
        ) {
          currentFunction = parent.id.name;
        }
      },
      CallExpression(path) {
        if (currentFunction) {
          const callee = path.node.callee;
          let calledFunction = '';

          if (callee.type === 'Identifier') {
            calledFunction = callee.name;
          } else if (
            callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier'
          ) {
            calledFunction = callee.property.name;
          }

          if (
            calledFunction &&
            functions.some(f => f.name === calledFunction)
          ) {
            edges.push({
              from: currentFunction,
              to: calledFunction,
            });
          }
        }
      },
    });
  }

  return {nodes, edges};
}

/**
 * 分析代码结构（函数、类、模块、调用图）。
 * 提取自 CodeAnalyzer.ts L203–L350。
 *
 * 关键改动（相对原方法）：
 * - 移除 `const self = this` —— `calculateComplexity` 现为直接函数调用
 * - `ast` 参数改为必传（由调用方传入解析好的 ast）
 * - `self.calculateComplexity(path)` 改为 `calculateComplexity(path)`
 * - `this.analyzeModules(code, ast)` 改为 `analyzeModules(code, ast)`
 * - `this.buildCallGraph(functions, code, ast)` 改为 `buildCallGraph(functions, ast)`
 */
export async function analyzeStructure(
  code: string,
  ast: t.File | null,
): Promise<CodeStructure> {
  const functions: FunctionInfo[] = [];
  const classes: ClassInfo[] = [];

  if (ast) {
    traverse(ast, {
      FunctionDeclaration(path) {
        const node = path.node;
        functions.push({
          name: node.id?.name || 'anonymous',
          params: node.params.map(p =>
            p.type === 'Identifier' ? p.name : 'unknown',
          ),
          location: {
            file: 'current',
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column,
          },
          complexity: calculateComplexity(path),
        });
      },

      FunctionExpression(path) {
        const node = path.node;
        const parent = path.parent;
        let name = 'anonymous';

        if (
          parent.type === 'VariableDeclarator' &&
          parent.id.type === 'Identifier'
        ) {
          name = parent.id.name;
        } else if (
          parent.type === 'AssignmentExpression' &&
          parent.left.type === 'Identifier'
        ) {
          name = parent.left.name;
        }

        functions.push({
          name,
          params: node.params.map(p =>
            p.type === 'Identifier' ? p.name : 'unknown',
          ),
          location: {
            file: 'current',
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column,
          },
          complexity: calculateComplexity(path),
        });
      },

      ArrowFunctionExpression(path) {
        const node = path.node;
        const parent = path.parent;
        let name = 'arrow';

        if (
          parent.type === 'VariableDeclarator' &&
          parent.id.type === 'Identifier'
        ) {
          name = parent.id.name;
        }

        functions.push({
          name,
          params: node.params.map(p =>
            p.type === 'Identifier' ? p.name : 'unknown',
          ),
          location: {
            file: 'current',
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column,
          },
          complexity: calculateComplexity(path),
        });
      },

      ClassDeclaration(path) {
        const node = path.node;
        const methods: FunctionInfo[] = [];
        const properties: ClassInfo['properties'] = [];

        path.traverse({
          ClassMethod(methodPath) {
            const method = methodPath.node;
            methods.push({
              name:
                method.key.type === 'Identifier' ? method.key.name : 'unknown',
              params: method.params.map(p =>
                p.type === 'Identifier' ? p.name : 'unknown',
              ),
              location: {
                file: 'current',
                line: method.loc?.start.line || 0,
                column: method.loc?.start.column,
              },
              complexity: 1,
            });
          },
          ClassProperty(propertyPath) {
            const property = propertyPath.node;
            if (property.key.type === 'Identifier') {
              properties.push({
                name: property.key.name,
                type: undefined,
                value: undefined,
              });
            }
          },
        });

        classes.push({
          name: node.id?.name || 'anonymous',
          methods,
          properties,
          location: {
            file: 'current',
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column,
          },
        });
      },
    });
  }

  const modules = analyzeModules(code, ast);
  const callGraph = buildCallGraph(functions, ast);

  return {
    functions,
    classes,
    modules,
    callGraph,
  };
}
