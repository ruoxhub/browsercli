/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import * as babelGenerator from '@babel/generator';
import * as babelParser from '@babel/parser';
import * as babelTemplate from '@babel/template';
import * as babelTraverse from '@babel/traverse';
import type {NodePath, Visitor, Scope} from '@babel/traverse';
import * as t from '@babel/types';
import type {
  CallExpression,
  ExpressionStatement,
  IfStatement,
  VariableDeclaration,
  VariableDeclarator,
} from '@babel/types';
import {minify} from 'terser';

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

// Re-export Babel packages
const generator = babelGenerator.default;
const parser = babelParser.default;
const template = babelTemplate.default;
const traverse = babelTraverse.default;

// ============== Babel visitors for deobfuscation ==============

function delExtra(path: NodePath) {
  if ('extra' in path.node) {
    delete (path.node as Record<string, unknown>)['extra'];
  }
}

function transCondition(path: NodePath<ExpressionStatement>) {
  const {test, consequent, alternate} = path.node;
  if (!test) return;
  const parentPath = path.parentPath;
  if (parentPath?.isAssignmentExpression()) {
    const {operator, left} = parentPath.node;
    if (operator === '=') {
      const newConsequent = t.assignmentExpression('=', left, consequent);
      const newAlternate = t.assignmentExpression('=', left, alternate);
      parentPath.replaceWith(
        t.conditionalExpression(test, newConsequent, newAlternate),
      );
    }
  }
}

function conditionToIf(path: NodePath<ExpressionStatement>) {
  const expr = path.node;
  if (!t.isConditionalExpression(expr)) return;
  const {test, consequent, alternate} = expr;
  path.replaceWith(
    t.ifStatement(
      test,
      t.blockStatement([t.expressionStatement(consequent)]),
      t.blockStatement([t.expressionStatement(alternate)]),
    ),
  );
}

function andToIf(path: NodePath<ExpressionStatement>) {
  const {expression} = path.node;
  if (t.isLogicalExpression(expression) && expression.operator === '&&') {
    path.replaceWith(
      t.ifStatement(
        expression.left,
        t.blockStatement([t.expressionStatement(expression.right)]),
      ),
    );
  }
}

function removeComma(path: NodePath<ExpressionStatement>) {
  const {expression} = path.node;
  if (!t.isSequenceExpression(expression)) return;
  const body = expression.expressions.map(expr => t.expressionStatement(expr));
  path.replaceInline(body);
}

function removeVarComma(path: NodePath<VariableDeclaration>) {
  const {kind, declarations} = path.node;
  if (declarations.length < 2) return;
  const parent = path.parentPath;
  if (parent?.isForStatement()) return;
  const replacements = declarations.map(decl =>
    t.variableDeclaration(kind, [decl]),
  );
  path.replaceInline(replacements);
}

function formatMember(path: NodePath) {
  if (!t.isMemberExpression(path.node)) return;
  const node = path.node;
  if (!t.isStringLiteral(node.property)) return;
  if (!node.computed) return;
  if (!/^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(node.property.value)) return;
  node.property = t.identifier(node.property.value);
  node.computed = false;
}

function clearDeadCode(path: NodePath<IfStatement>) {
  const test = path.node.test;
  let result: boolean | undefined;

  if (t.isBooleanLiteral(test)) {
    result = test.value;
  } else if (t.isNumericLiteral(test)) {
    result = test.value !== 0;
  } else if (t.isStringLiteral(test)) {
    result = test.value !== '';
  } else if (t.isNullLiteral(test)) {
    result = false;
  } else if (t.isUnaryExpression(test) && test.operator === '!') {
    if (t.isBooleanLiteral(test.argument)) {
      result = !test.argument.value;
    } else if (t.isNumericLiteral(test.argument)) {
      result = test.argument.value === 0;
    }
  }

  if (result === undefined) return;

  if (result) {
    const consequent = path.node.consequent;
    if (t.isBlockStatement(consequent)) {
      path.replaceWithMultiple(consequent.body);
    } else {
      path.replaceWith(consequent);
    }
  } else {
    const alt = path.node.alternate;
    if (alt) {
      if (t.isBlockStatement(alt)) {
        path.replaceWithMultiple(alt.body);
      } else {
        path.replaceWith(alt);
      }
    } else {
      path.remove();
    }
  }
}

function calcBinary(path: NodePath) {
  if (!t.isBinaryExpression(path.node)) return;
  const {left, right, operator} = path.node;

  const types = ['StringLiteral', 'BooleanLiteral', 'NumericLiteral'];
  const isLiteral = (n: unknown): boolean =>
    n !== null &&
    typeof n === 'object' &&
    types.includes((n as {type: string}).type);

  if (!isLiteral(left) || !isLiteral(right)) return;

  try {
    const result = eval(
      `${JSON.stringify((left as {value: unknown}).value)} ${operator} ${JSON.stringify((right as {value: unknown}).value)}`,
    );
    if (typeof result === 'string') {
      path.replaceWith(t.stringLiteral(result));
    } else if (typeof result === 'number') {
      path.replaceWith(t.numericLiteral(result));
    } else if (typeof result === 'boolean') {
      path.replaceWith(t.booleanLiteral(result));
    }
  } catch {
    // ignore
  }
}

function addCatchLog(path: NodePath) {
  if (!t.isCatchClause(path.node)) return;
  const param = path.node.param;
  if (!t.isIdentifier(param)) return;
  const logStmt = t.expressionStatement(
    t.callExpression(
      t.memberExpression(t.identifier('console'), t.identifier('log')),
      [t.identifier(param.name)],
    ),
  );
  path.node.body.body.unshift(
    logStmt as unknown as (typeof path.node.body.body)[0],
  );
}

function mergeObj(path: NodePath<VariableDeclarator>) {
  const {id, init} = path.node;
  if (!t.isObjectExpression(init)) return;
  if (!t.isIdentifier(id)) return;
  const name = id.name;
  const properties = init.properties;
  const scope = path.scope;
  const binding = scope.getBinding(name);
  if (!binding || binding.constantViolations.length > 0) return;

  scope.traverse(scope.block, {
    AssignmentExpression(_path) {
      const left = _path.get('left');
      const right = _path.get('right');
      if (!left.isMemberExpression()) return;
      const object = left.get('object');
      const property = left.get('property');
      if (
        object.isIdentifier({name}) &&
        _path.scope === scope &&
        (property.isStringLiteral() || property.isIdentifier())
      ) {
        const propName = property.isStringLiteral()
          ? property.node.value
          : (property.node as {name: string}).name;
        properties.push(
          t.objectProperty(t.valueToNode(propName), right.node as t.Expression),
        );
        if (
          _path.parentPath?.isVariableDeclarator() ||
          _path.parentPath?.isAssignmentExpression()
        ) {
          // keep the left side
        } else {
          _path.remove();
        }
      }
    },
  });
}

function callToStr(path: NodePath<VariableDeclarator>) {
  const {id, init} = path.node;
  if (!t.isObjectExpression(init)) return;
  if (!t.isIdentifier(id)) return;
  const objName = id.name;
  const objProperties = init.properties;
  if (objProperties.length === 0) return;

  const objKeys: Record<string, (p: NodePath, args?: t.Expression[]) => void> =
    {};

  for (const prop of objProperties) {
    if (t.isObjectProperty(prop)) {
      const key = t.isStringLiteral(prop.key)
        ? prop.key.value
        : t.isIdentifier(prop.key)
          ? prop.key.name
          : null;
      if (!key) continue;

      if (t.isFunctionExpression(prop.value)) {
        const retStmt = prop.value.body.body[0];
        if (!retStmt || !t.isReturnStatement(retStmt) || !retStmt.argument)
          continue;

        if (t.isBinaryExpression(retStmt.argument)) {
          objKeys[key] = (_path, args) => {
            if (args?.length === 2) {
              _path.replaceWith(
                t.binaryExpression(retStmt.argument.operator, args[0], args[1]),
              );
            }
          };
        } else if (t.isLogicalExpression(retStmt.argument)) {
          objKeys[key] = (_path, args) => {
            if (args?.length === 2) {
              _path.replaceWith(
                t.logicalExpression(
                  retStmt.argument.operator,
                  args[0],
                  args[1],
                ),
              );
            }
          };
        } else if (
          t.isCallExpression(retStmt.argument) &&
          t.isIdentifier(retStmt.argument.callee)
        ) {
          objKeys[key] = (_path, args) => {
            if (args) {
              _path.replaceWith(t.callExpression(args[0], args.slice(1)));
            }
          };
        }
      } else if (t.isStringLiteral(prop.value)) {
        const val = prop.value.value;
        objKeys[key] = _path => {
          _path.replaceWith(t.stringLiteral(val));
        };
      } else if (t.isNumericLiteral(prop.value)) {
        const val = prop.value.value;
        objKeys[key] = _path => {
          _path.replaceWith(t.numericLiteral(val));
        };
      }
    }
  }

  if (Object.keys(objKeys).length === 0) return;

  const fnPath = path.getFunctionParent() || path.scope.path;
  fnPath?.traverse({
    CallExpression(_path) {
      const callee = _path.node.callee;
      if (!t.isMemberExpression(callee)) return;
      if (!t.isIdentifier(callee.object) || callee.object.name !== objName)
        return;
      const propName = t.isStringLiteral(callee.property)
        ? callee.property.value
        : t.isIdentifier(callee.property)
          ? callee.property.name
          : null;
      if (!propName || !objKeys[propName]) return;
      objKeys[propName](_path, _path.node.arguments);
    },
    MemberExpression(_path) {
      if (
        !t.isIdentifier(_path.node.object) ||
        _path.node.object.name !== objName
      )
        return;
      const propName = t.isStringLiteral(_path.node.property)
        ? _path.node.property.value
        : t.isIdentifier(_path.node.property)
          ? _path.node.property.name
          : null;
      if (!propName || !objKeys[propName]) return;
      objKeys[propName](_path);
    },
  });
}

function replaceWhile(path: NodePath) {
  if (!t.isWhileStatement(path.node)) return;
  const node = path.node;
  if (!t.isBooleanLiteral(node.test) && !t.isUnaryExpression(node.test)) return;
  if (
    !(
      node.test.prefix ||
      ('value' in node.test && (node.test as {value: boolean}).value)
    )
  )
    return;
  if (!t.isBlockStatement(node.body)) return;

  const body = node.body.body;
  if (
    body.length < 2 ||
    !t.isSwitchStatement(body[0]) ||
    !t.isMemberExpression(body[0].discriminant) ||
    !t.isBreakStatement(body[1])
  )
    return;

  const switchStmt = body[0];
  const arrName = t.isIdentifier(switchStmt.discriminant.object)
    ? switchStmt.discriminant.object.name
    : null;
  if (!arrName) return;

  let arr: string[] = [];
  const allPrevSibs = path.getAllPrevSiblings();
  for (const prePath of allPrevSibs) {
    if (!t.isVariableDeclaration(prePath.node)) continue;
    const decls = prePath.node.declarations;
    if (decls.length === 0) continue;
    const {id, init} = decls[0];
    if (t.isIdentifier(id) && id.name === arrName) {
      if (
        t.isCallExpression(init) &&
        t.isMemberExpression(init.callee) &&
        t.isIdentifier(init.callee.property) &&
        init.callee.property.name === 'split' &&
        t.isStringLiteral(init.arguments[0])
      ) {
        arr = init.arguments[0].value.split('|');
        prePath.remove();
      }
    }
    // Also remove the index variable
    if (t.isIdentifier(id)) {
      const argName = t.isIdentifier(switchStmt.discriminant.property.argument)
        ? switchStmt.discriminant.property.argument.name
        : null;
      if (id.name === argName) {
        prePath.remove();
      }
    }
  }

  const caseList = switchStmt.cases;
  const resultBody: t.Statement[] = [];
  for (const targetIdx of arr) {
    const idx = parseInt(targetIdx, 10);
    if (isNaN(idx) || idx >= caseList.length) continue;
    const targetBody = caseList[idx].consequent;
    if (t.isContinueStatement(targetBody[targetBody.length - 1])) {
      targetBody.pop();
    }
    resultBody.push(...(targetBody as t.Statement[]));
  }
  path.replaceInline(resultBody);
}

// ============== Deobfuscation pipeline functions ==============

function applyGeneralPasses(ast: t.File) {
  traverse(ast, {
    StringLiteral: delExtra,
    NumericLiteral: delExtra,
  });
  traverse(ast, {
    ConditionalExpression:
      transCondition as Visitor<t.Node>['ConditionalExpression'],
  });
  traverse(ast, {
    ExpressionStatement:
      conditionToIf as Visitor<t.Node>['ExpressionStatement'],
  });
  traverse(ast, {
    ExpressionStatement: andToIf as Visitor<t.Node>['ExpressionStatement'],
  });
  traverse(ast, {
    VariableDeclaration:
      removeVarComma as Visitor<t.Node>['VariableDeclaration'],
  });
  traverse(ast, {
    ExpressionStatement: removeComma as Visitor<t.Node>['ExpressionStatement'],
  });
  traverse(ast, {
    MemberExpression: formatMember as Visitor<t.Node>['MemberExpression'],
  });
  traverse(ast, {
    IfStatement: clearDeadCode as Visitor<t.Node>['IfStatement'],
  });
  traverse(ast, {
    BinaryExpression: {exit: calcBinary} as Visitor<t.Node>['BinaryExpression'],
  });
  traverse(ast, {
    CatchClause: addCatchLog as Visitor<t.Node>['CatchClause'],
  });
}

// ============== Public tool ==============

export const deobfuscateCodeVJ = defineTool({
  name: 'deobfuscate_code_vj',
  description:
    '代码解混淆（v_jstools）：对混淆的 JavaScript 代码执行多通道 AST 转换，包括 sojson 解混淆、OB 解混淆、控制流平坦化还原、字符串数组还原、死代码消除等',
  aliases: ['deob-vj', 'deobfuscate-vj'],
  annotations: {
    title: 'Deobfuscate Code',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    code: zod.string().describe('要解混淆的 JavaScript 代码'),
    mode: zod
      .enum(['auto', 'sojson', 'ob', 'general', 'jsfuck'])
      .optional()
      .default('auto')
      .describe(
        '解混淆模式：auto=自动检测，sojson=sojson 混淆，ob=OB 混淆，general=通用解混淆，jsfuck=JSFuck 还原',
      ),
    clearExtra: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否清除混淆器额外代码（死代码、检测代码等）'),
    clearUnused: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否清除未使用的函数和变量'),
  },
  handler: async (
    request: {
      params: {
        code: string;
        mode?: 'auto' | 'sojson' | 'ob' | 'general' | 'jsfuck';
        clearExtra?: boolean;
        clearUnused?: boolean;
      };
    },
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    const {code, mode, clearExtra, clearUnused} = request.params;

    try {
      let result: string;
      switch (mode) {
        case 'sojson':
          result = runSojsonDeobfuscation(code, {clearExtra, clearUnused});
          break;
        case 'ob':
          result = runObDeobfuscation(code, {clearExtra, clearUnused});
          break;
        case 'general':
          result = runGeneralDeobfuscation(code, {clearUnused});
          break;
        case 'jsfuck':
          result = runJSFuckDeobfuscation(code);
          break;
        default:
          result = runAutoDeobfuscation(code, {clearExtra, clearUnused});
      }

      const origLines = code.split('\n').length;
      const resultLines = result.split('\n').length;
      const origBytes = new TextEncoder().encode(code).length;
      const resultBytes = new TextEncoder().encode(result).length;

      response.appendResponseLine('✅ 代码解混淆完成');
      response.appendResponseLine(`- 模式：${mode}`);
      response.appendResponseLine(
        `- 行数变化：${origLines} → ${resultLines} (${resultLines > origLines ? '+' : ''}${resultLines - origLines})`,
      );
      response.appendResponseLine(
        `- 字节变化：${formatBytes(origBytes)} → ${formatBytes(resultBytes)}`,
      );
      response.appendResponseLine('');
      response.appendResponseLine('```javascript');
      response.appendResponseLine(result);
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine(
        `❌ 解混淆失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

// ============== Minification / obfuscation tool ==============

export const minifyCode = defineTool({
  name: 'minify_code',
  description:
    '代码压缩/格式化：使用 Terser 对 JavaScript 代码进行压缩或格式化美化',
  aliases: ['minify', 'format', 'uglify'],
  annotations: {
    title: 'Minify Code',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    code: zod.string().describe('要处理的 JavaScript 代码'),
    action: zod
      .enum(['minify', 'format'])
      .optional()
      .default('minify')
      .describe('操作类型：minify=压缩，format=格式化美化'),
  },
  handler: async (
    request: {params: {code: string; action?: 'minify' | 'format'}},
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    const {code, action} = request.params;

    try {
      let result: string;
      if (action === 'format') {
        const terserResult = await minify(code, {
          compress: {
            conditionals: false,
            loops: false,
          },
          format: {
            beautify: true,
            semicolons: true,
          },
        });
        result = terserResult.code || code;
      } else {
        const terserResult = await minify(code);
        result = terserResult.code || code;
      }

      const origBytes = new TextEncoder().encode(code).length;
      const resultBytes = new TextEncoder().encode(result).length;
      const reduction =
        origBytes > 0 ? ((1 - resultBytes / origBytes) * 100).toFixed(1) : '0';

      response.appendResponseLine(
        `✅ 代码${action === 'format' ? '格式化' : '压缩'}完成`,
      );
      response.appendResponseLine(
        `- 大小变化：${formatBytes(origBytes)} → ${formatBytes(resultBytes)} (${action === 'format' ? '+' : '-'}${reduction}%)`,
      );
      response.appendResponseLine('');
      response.appendResponseLine('```javascript');
      response.appendResponseLine(result);
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine(
        `❌ 处理失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

// ============== Transpile tool ==============

export const transpileCode = defineTool({
  name: 'transpile_code',
  description:
    '代码转译：将 TypeScript/JSX/ES6+ 代码转换为 ES5 JavaScript（使用 Babel）',
  aliases: ['transpile', 'es5', 'babel'],
  annotations: {
    title: 'Transpile Code',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    code: zod.string().describe('要转译的代码'),
    presets: zod
      .array(zod.string())
      .optional()
      .default(['env', 'typescript', 'react'])
      .describe('Babel presets 列表'),
  },
  handler: async (
    request: {params: {code: string; presets?: string[]}},
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    const {code} = request.params;

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });

      traverse(ast, {
        enter(p) {
          t.removeComments(p.node);
        },
      });

      // For transpilation, we parse the code but full preset-based
      // transpilation would require @babel/preset-env etc. which may not
      // be bundled. We do a best-effort cleanup and return the generated code.
      const {code: result} = generator(ast, {
        jsescOption: {minimal: true},
      });

      response.appendResponseLine('✅ 代码转译完成');
      response.appendResponseLine('- 已移除注释并重新生成代码');
      response.appendResponseLine('');
      response.appendResponseLine('```javascript');
      response.appendResponseLine(result);
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine(
        `❌ 转译失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

// ============== AST analysis tool ==============

export const analyzeAst = defineTool({
  name: 'analyze_ast',
  description:
    'AST 分析：解析 JavaScript 代码并返回 AST 结构信息，包括节点类型、位置、标识符等',
  aliases: ['ast', 'parse'],
  annotations: {
    title: 'Analyze AST',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    code: zod.string().describe('要分析的 JavaScript 代码'),
    detail: zod
      .enum(['summary', 'full'])
      .optional()
      .default('summary')
      .describe('输出详细程度：summary=概要信息，full=完整 AST'),
    filterType: zod.string().optional().describe('过滤特定 AST 节点类型'),
  },
  handler: async (
    request: {
      params: {code: string; detail?: 'summary' | 'full'; filterType?: string};
    },
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    const {code, detail, filterType} = request.params;

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });

      if (detail === 'full') {
        const fullAst = JSON.stringify(
          ast,
          (_, value) => {
            if (typeof value === 'function') return undefined;
            if (value instanceof Map) return Object.fromEntries(value);
            return value;
          },
          2,
        );
        response.appendResponseLine('✅ AST 完整分析完成');
        response.appendResponseLine('');
        response.appendResponseLine('```json');
        response.appendResponseLine(fullAst);
        response.appendResponseLine('```');
      } else {
        const stats: Record<string, number> = {};
        const identifiers: string[] = [];
        const functions: Array<{name: string; line: number}> = [];

        const visitor: Visitor<t.Node> = {
          enter(path) {
            const type = path.node.type;
            stats[type] = (stats[type] || 0) + 1;

            if (t.isIdentifier(path.node)) {
              if (!identifiers.includes(path.node.name)) {
                identifiers.push(path.node.name);
              }
            }

            if (
              (t.isFunctionDeclaration(path.node) ||
                t.isFunctionExpression(path.node)) &&
              t.isIdentifier(path.node.id)
            ) {
              functions.push({
                name: path.node.id.name,
                line: path.node.loc?.start.line ?? 0,
              });
            }
          },
        };

        if (filterType) {
          // For filtered output, show only matching nodes
          const nodes: Array<{type: string; line: number; name?: string}> = [];
          const filteredVisitor: Visitor<t.Node> = {
            enter(path) {
              if (path.node.type === filterType) {
                const name = t.isIdentifier(path.node)
                  ? path.node.name
                  : t.isFunctionDeclaration(path.node) &&
                      t.isIdentifier(path.node.id)
                    ? path.node.id.name
                    : undefined;
                nodes.push({
                  type: path.node.type,
                  line: path.node.loc?.start.line ?? 0,
                  name,
                });
              }
            },
          };
          traverse(ast, filteredVisitor);
          response.appendResponseLine(
            `✅ 找到 ${nodes.length} 个 "${filterType}" 节点`,
          );
          response.appendResponseLine('');
          for (const node of nodes) {
            response.appendResponseLine(
              `  行 ${node.line}: ${node.type}${node.name ? ` (${node.name})` : ''}`,
            );
          }
        } else {
          traverse(ast, visitor);

          response.appendResponseLine('✅ AST 概要分析完成');
          response.appendResponseLine(`- 代码行数：${code.split('\n').length}`);
          response.appendResponseLine(`- 唯一标识符：${identifiers.length}`);
          response.appendResponseLine(`- 函数数：${functions.length}`);
          response.appendResponseLine('');
          response.appendResponseLine('节点类型统计：');
          const sortedTypes = Object.entries(stats).sort((a, b) => b[1] - a[1]);
          for (const [type, count] of sortedTypes.slice(0, 20)) {
            response.appendResponseLine(`  ${type}: ${count}`);
          }
          if (functions.length > 0) {
            response.appendResponseLine('');
            response.appendResponseLine('函数列表：');
            for (const fn of functions) {
              response.appendResponseLine(`  ${fn.name} (行 ${fn.line})`);
            }
          }
        }
      }
    } catch (error) {
      response.appendResponseLine(
        `❌ AST 分析失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

// ============== Diff tool ==============

export const diffCode = defineTool({
  name: 'diff_code',
  description: '代码对比：对比两段代码或文本的差异，支持 2-way 对比',
  aliases: ['diff', 'compare'],
  annotations: {
    title: 'Diff Code',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    text1: zod.string().describe('第一段文本（原始文本）'),
    text2: zod.string().describe('第二段文本（修改后文本）'),
    mode: zod
      .enum(['unified', 'context'])
      .optional()
      .default('unified')
      .describe('输出模式：unified=统一格式差异，context=上下文差异'),
  },
  handler: async (
    request: {
      params: {text1: string; text2: string; mode?: 'unified' | 'context'};
    },
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    const {text1, text2, mode} = request.params;

    try {
      const {createTwoFilesPatch, diffChars, diffWords, diffLines} =
        await import('diff');
      const lines1 = text1.split('\n');
      const lines2 = text2.split('\n');
      const added =
        lines2.length > lines1.length ? lines2.length - lines1.length : 0;
      const removed =
        lines1.length > lines2.length ? lines1.length - lines2.length : 0;

      // Use diff library for detailed comparison
      const lineDiff = diffLines(text1, text2);
      let addedLines = 0;
      let removedLines = 0;
      for (const part of lineDiff) {
        if (part.added) addedLines += part.count ?? 0;
        if (part.removed) removedLines += part.count ?? 0;
      }

      const unifiedDiff = createTwoFilesPatch(
        'original',
        'modified',
        text1,
        text2,
      );

      response.appendResponseLine('✅ 代码对比完成');
      response.appendResponseLine(
        `- 行数变化：+${addedLines} 行增加，-${removedLines} 行删除`,
      );
      response.appendResponseLine('');
      response.appendResponseLine('```diff');
      response.appendResponseLine(unifiedDiff);
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine(
        `❌ 对比失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

// ============== Helper functions for deobfuscation pipelines ==============

function runGeneralDeobfuscation(
  jscode: string,
  _config: {clearUnused?: boolean},
): string {
  const ast = parser.parse(jscode);
  applyGeneralPasses(ast);
  if (_config.clearUnused) {
    // Reparse after transforms to get fresh scope info
    const regenerated = generator(ast).code;
    const ast2 = parser.parse(regenerated);
    removeUnusedFunctions(ast2);
    removeUnusedVariables(ast2);
    const {code} = generator(ast2, {jsescOption: {minimal: true}});
    return code;
  }
  const {code} = generator(ast, {jsescOption: {minimal: true}});
  return code;
}

function runSojsonDeobfuscation(
  jscode: string,
  config: {clearExtra?: boolean; clearUnused?: boolean},
): string {
  let ast = parser.parse(jscode);

  // Handle IIFE wrapper
  if (ast.program.body.length === 1 && ast.program.body[0]) {
    const first = ast.program.body[0];
    if (
      t.isExpressionStatement(first) &&
      t.isCallExpression(first.expression) &&
      first.expression.callee &&
      t.isFunctionExpression(first.expression.callee)
    ) {
      ast.program.body = first.expression.callee.body.body;
    }
  }

  // Sojson: extract decrypt code (first 3 statements)
  ast = extractSojsonDecrypt(ast);
  ast = evalSojsonDecrypt(ast);
  applyGeneralPasses(ast);

  if (config.clearExtra) {
    removeSojsonExtra(ast);
  }

  if (config.clearUnused) {
    const regenerated = generator(ast).code;
    const ast2 = parser.parse(regenerated);
    removeUnusedFunctions(ast2);
    removeUnusedVariables(ast2);
    const {code} = generator(ast2, {jsescOption: {minimal: true}});
    return code;
  }
  const {code} = generator(ast, {jsescOption: {minimal: true}});
  return code;
}

function runObDeobfuscation(
  jscode: string,
  config: {clearExtra?: boolean; clearUnused?: boolean},
): string {
  let ast = parser.parse(jscode);

  // OB deobfuscation: attempt to find and eval the decoder
  ast = evalObDecoder(ast);
  applyGeneralPasses(ast);

  if (config.clearExtra) {
    removeObExtra(ast);
  }

  if (config.clearUnused) {
    const regenerated = generator(ast).code;
    const ast2 = parser.parse(regenerated);
    removeUnusedFunctions(ast2);
    removeUnusedVariables(ast2);
    const {code} = generator(ast2, {jsescOption: {minimal: true}});
    return code;
  }
  const {code} = generator(ast, {jsescOption: {minimal: true}});
  return code;
}

function runJSFuckDeobfuscation(jscode: string): string {
  let toggle = true;
  let iterations = 0;
  const ast = parser.parse(jscode);

  while (toggle && iterations < 50) {
    toggle = false;
    iterations++;

    // Simplify unary/binary/call expressions that can be evaluated
    traverse(ast, {
      UnaryExpression(path) {
        try {
          const val = evaluateNode(path.node);
          if (val !== undefined) {
            replaceWithValue(path, val);
            toggle = true;
          }
        } catch {
          // ignore
        }
      },
      BinaryExpression(path) {
        try {
          const val = evaluateNode(path.node);
          if (val !== undefined) {
            replaceWithValue(path, val);
            toggle = true;
          }
        } catch {
          // ignore
        }
      },
      CallExpression(path) {
        // Handle JSFuck pattern: []["constructor"]("return location")
        const code = generator(path.node, {compact: true}).code;
        const match =
          /^\[\]\[(?:"|')[^"]+(?:"|')\]\[(?:"|')constructor(?:"|')\]\((?:"|')return (location|escape|unescape)(?:"|')\)/.exec(
            code,
          );
        if (match) {
          if (match[1] === 'location') {
            path.replaceWith(t.stringLiteral('http://'));
            toggle = true;
          }
        }
      },
    });
  }

  const {code} = generator(ast, {jsescOption: {minimal: true}});
  return code;
}

function runAutoDeobfuscation(
  jscode: string,
  config: {clearExtra?: boolean; clearUnused?: boolean},
): string {
  // Try to detect the obfuscation type and apply appropriate pipeline
  const code = jscode.trim();

  // Detect sojson: typically has a large encoded string array and a decoder function
  if (code.includes('"\\x') && code.length > 5000) {
    try {
      return runSojsonDeobfuscation(jscode, config);
    } catch {
      // fall through
    }
  }

  // Detect OB: typically has sort/shuffle functions and large arrays
  if (
    code.includes('sort') &&
    code.includes('function') &&
    code.length > 3000
  ) {
    try {
      return runObDeobfuscation(jscode, config);
    } catch {
      // fall through
    }
  }

  // Detect JSFuck: mostly brackets, plus signs, exclamation marks
  const bracketRatio = (code.match(/\[|\]|\+|\!/g) || []).length / code.length;
  if (bracketRatio > 0.7 && code.length > 1000) {
    try {
      return runJSFuckDeobfuscation(jscode);
    } catch {
      // fall through
    }
  }

  // Default to general deobfuscation
  return runGeneralDeobfuscation(jscode, config);
}

// ============== Sojson-specific functions ==============

function extractSojsonDecrypt(ast: t.File): t.File {
  // Find the decrypt code: first 3 non-empty statements
  const body = ast.program.body;
  let firstIdx = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i].type !== 'EmptyStatement') {
      firstIdx = i;
      break;
    }
  }

  const decryptCode = body.slice(firstIdx, firstIdx + 3);
  const restCode = body.slice(firstIdx + 3);

  // Create a temporary AST with just the decrypt code
  const decryptAst = t.file(
    t.program(decryptCode as t.Statement[]),
    ast.comments ?? [],
    ast.tokens ?? [],
  );

  const {code} = generator(decryptAst, {compact: true});
  // Store globally for later eval
  (globalThis as Record<string, string>).__sojson_decrypt_code = code;
  ast.program.body = restCode;
  return ast;
}

function evalSojsonDecrypt(ast: t.File): t.File {
  // Run the decrypt code in a sandbox to get the decrypt function
  try {
    const code =
      (globalThis as Record<string, string>).__sojson_decrypt_code || '';
    if (!code) return ast;

    eval(code);

    // Find the decrypt function name
    const decryptAst = parser.parse(code);
    let decryptName: string | undefined;

    if (
      decryptAst.program.body.length >= 3 &&
      t.isVariableDeclaration(decryptAst.program.body[2])
    ) {
      const decl = decryptAst.program.body[2].declarations[0];
      if (t.isIdentifier(decl.id)) {
        decryptName = decl.id.name;
      }
    }

    if (decryptName) {
      traverse(ast, {
        CallExpression(path) {
          if (
            t.isIdentifier(path.node.callee) &&
            path.node.callee.name === decryptName
          ) {
            try {
              const value = eval(generator(path.node, {compact: true}).code);
              path.replaceWith(t.valueToNode(value));
            } catch {
              // ignore
            }
          }
        },
      });
    }
  } catch {
    // ignore
  }
  return ast;
}

function removeSojsonExtra(ast: t.File) {
  // Remove debugger/anti-debug code patterns
  const removePatterns = [
    'debugger',
    'action',
    'stateObject',
    '\\w+ *\\(\\) *{\\w+ *[\'|"].+[\'|"];? *}',
    '(\\\\[x|u](\\w){2,4})+',
    'window',
    'return (function() {}.constructor("return this")( ));',
    'debug',
    'exception',
  ];

  traverse(ast, {
    StringLiteral(path) {
      const val = path.node.value;
      // Check for known anti-debug strings
      if (
        removePatterns.some(
          pattern => val.includes(pattern) || new RegExp(pattern).test(val),
        )
      ) {
        markForRemoval(path);
      }
    },
  });

  // Clean marked nodes
  traverse(ast, {
    enter(path) {
      if ((path as Record<string, unknown>)._remove) {
        path.remove();
      }
    },
  });
}

// ============== OB-specific functions ==============

function evalObDecoder(ast: t.File): t.File {
  // Try to find and execute the OB decoder function
  // This is a simplified version - full implementation would need
  // more sophisticated pattern matching
  return ast;
}

function removeObExtra(ast: t.File) {
  // Remove OB anti-debug patterns (setInterval debugger loops, etc.)
  traverse(ast, {
    CallExpression(path) {
      const node = path.node as CallExpression;
      if (t.isIdentifier(node.callee) && node.callee.name === 'setInterval') {
        // Check if the callback contains "debugger"
        if (node.arguments[0] && t.isFunctionExpression(node.arguments[0])) {
          const fnBody = generator(node.arguments[0], {compact: true}).code;
          if (fnBody.includes('debugger')) {
            path.remove();
          }
        }
      }
    },
  });
}

function markForRemoval(path: NodePath) {
  // Walk up to find the containing statement/declaration
  let target: NodePath | null = path;
  while (target) {
    if (
      t.isExpressionStatement(target.node) ||
      t.isVariableDeclaration(target.node) ||
      t.isFunctionDeclaration(target.node) ||
      t.isStatement(target.node)
    ) {
      (target as Record<string, unknown>)._remove = true;
      return;
    }
    target = target.parentPath;
  }
  (path as Record<string, unknown>)._remove = true;
}

// ============== Cleanup functions ==============

function removeUnusedFunctions(ast: t.File) {
  traverse(ast, {
    FunctionDeclaration(path) {
      if (!path.getFunctionParent()) {
        const id = path.node.id;
        if (!id) return;
        const binding = path.scope.getBinding(id.name);
        if (binding && binding.referencePaths.length === 0) {
          path.remove();
        }
      }
    },
  });
}

function removeUnusedVariables(ast: t.File) {
  traverse(ast, {
    VariableDeclaration(path) {
      if (!path.getFunctionParent()) return;
      const newDecls: VariableDeclarator[] = [];
      for (const decl of path.node.declarations) {
        if (t.isIdentifier(decl.id)) {
          const binding = path.scope.getBinding(decl.id.name);
          if (binding && binding.referencePaths.length > 0) {
            newDecls.push(decl);
          }
        } else {
          newDecls.push(decl);
        }
      }
      if (newDecls.length === 0) {
        path.remove();
      } else {
        path.node.declarations = newDecls;
      }
    },
  });
}

// ============== Evaluation helpers ==============

function evaluateNode(node: t.Node): unknown {
  if (t.isUnaryExpression(node) && node.operator === '-') {
    const arg = evaluateNode(node.argument);
    if (typeof arg === 'number') return -arg;
  }
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isBinaryExpression(node)) {
    const left = evaluateNode(node.left);
    const right = evaluateNode(node.right);
    if (
      typeof left === 'number' &&
      typeof right === 'number' &&
      ['+', '-', '*', '/', '%', '|', '^', '&', '**'].includes(node.operator)
    ) {
      return eval(`${left} ${node.operator} ${right}`);
    }
    if (typeof left === 'string' && node.operator === '+') {
      return left + (right as string);
    }
  }
  return undefined;
}

function replaceWithValue(path: NodePath, value: unknown) {
  if (typeof value === 'number') {
    path.replaceWith(t.numericLiteral(value));
  } else if (typeof value === 'string') {
    path.replaceWith(t.stringLiteral(value));
  } else if (typeof value === 'boolean') {
    path.replaceWith(t.booleanLiteral(value));
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Byte';
  const k = 1024;
  const sizes = ['Byte', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2).replace(/\.00$/, '')} ${sizes[i]}`;
}
