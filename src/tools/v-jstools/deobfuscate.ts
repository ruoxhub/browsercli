/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as babelGenerator from '@babel/generator';
import * as babelParser from '@babel/parser';
import * as babelTraverse from '@babel/traverse';
import type {NodePath, Visitor} from '@babel/traverse';
import * as t from '@babel/types';
import type {
  CallExpression,
  ExpressionStatement,
  IfStatement,
  VariableDeclaration,
  VariableDeclarator,
} from '@babel/types';
import {minify} from 'terser';

import type {
  DeobfuscateParams,
  DeobfuscateResult,
  MinifyParams,
  MinifyResult,
  TranspileParams,
  TranspileResult,
  AnalyzeAstParams,
  AnalyzeAstResult,
  DiffParams,
  DiffResult,
} from './types.js';

// Re-export Babel packages
const generator = babelGenerator.default;
const parser = babelParser.default;
const traverse = babelTraverse.default;

// ============== Babel visitors for deobfuscation ==============

function delExtra(path: NodePath) {
  if ('extra' in path.node) {
    delete (path.node as unknown as Record<string, unknown>)['extra'];
  }
}

function transCondition(path: NodePath<t.IfStatement>) {
  const {test, consequent, alternate} = path.node;
  if (!test) return;
  const parentPath = path.parentPath;
  if (parentPath?.isAssignmentExpression()) {
    const {operator, left} = parentPath.node;
    if (operator === '=') {
      const newConsequent = t.assignmentExpression(
        '=',
        left,
        consequent as unknown as t.Expression,
      );
      const newAlternate = t.assignmentExpression(
        '=',
        left,
        alternate as unknown as t.Expression,
      );
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

function _mergeObj(path: NodePath<VariableDeclarator>) {
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

function _callToStr(path: NodePath<VariableDeclarator>) {
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
                t.binaryExpression(
                  (retStmt.argument as unknown as {operator: string})
                    .operator as t.BinaryExpression['operator'],
                  args[0],
                  args[1],
                ),
              );
            }
          };
        } else if (t.isLogicalExpression(retStmt.argument)) {
          objKeys[key] = (_path, args) => {
            if (args?.length === 2) {
              _path.replaceWith(
                t.logicalExpression(
                  (retStmt.argument as unknown as {operator: string})
                    .operator as t.LogicalExpression['operator'],
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
      objKeys[propName](_path, _path.node.arguments as t.Expression[]);
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

function _replaceWhile(path: NodePath) {
  if (!t.isWhileStatement(path.node)) return;
  const node = path.node;
  if (!t.isBooleanLiteral(node.test) && !t.isUnaryExpression(node.test)) return;
  if (
    !(
      ('prefix' in node.test && node.test.prefix) ||
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
  const arrName =
    t.isMemberExpression(switchStmt.discriminant) &&
    t.isIdentifier(switchStmt.discriminant.object)
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
    if (t.isIdentifier(id)) {
      const argName =
        (
          switchStmt.discriminant as unknown as {
            property?: {argument?: {name?: string}};
          }
        ).property?.argument?.name ?? null;
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

// ============== Pipeline runners (pure functions) ==============

function runGeneralDeobfuscation(
  jscode: string,
  _config: {clearUnused?: boolean},
): string {
  const ast = parser.parse(jscode);
  applyGeneralPasses(ast);
  if (_config.clearUnused) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ast = extractSojsonDecrypt(ast) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ast = evalSojsonDecrypt(ast) as any;
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
  ast = evalObDecoder(ast) as unknown as typeof ast;
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
  const code = jscode.trim();

  if (code.includes('"\\x') && code.length > 5000) {
    try {
      return runSojsonDeobfuscation(jscode, config);
    } catch {
      // fall through
    }
  }

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

  const bracketRatio = (code.match(/\[|\]|\+|!/g) || []).length / code.length;
  if (bracketRatio > 0.7 && code.length > 1000) {
    try {
      return runJSFuckDeobfuscation(jscode);
    } catch {
      // fall through
    }
  }

  return runGeneralDeobfuscation(jscode, config);
}

// ============== Sojson-specific functions ==============

function extractSojsonDecrypt(ast: t.File): t.File {
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

  const decryptAst = t.file(
    t.program(decryptCode as t.Statement[]),
    ast.comments ?? [],
    ast.tokens ?? [],
  );

  const {code} = generator(decryptAst, {compact: true});
  (globalThis as unknown as Record<string, string>).__sojson_decrypt_code =
    code;
  ast.program.body = restCode;
  return ast;
}

function evalSojsonDecrypt(ast: t.File): t.File {
  try {
    const code =
      (globalThis as unknown as Record<string, string>).__sojson_decrypt_code ||
      '';
    if (!code) return ast;

    eval(code);

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
      if (
        removePatterns.some(
          pattern => val.includes(pattern) || new RegExp(pattern).test(val),
        )
      ) {
        markForRemoval(path);
      }
    },
  });

  traverse(ast, {
    enter(path) {
      if ((path as unknown as {_remove?: boolean})._remove) {
        path.remove();
      }
    },
  });
}

// ============== OB-specific functions ==============

function evalObDecoder(ast: t.File): t.File {
  return ast;
}

function removeObExtra(ast: t.File) {
  traverse(ast, {
    CallExpression(path) {
      const node = path.node as CallExpression;
      if (t.isIdentifier(node.callee) && node.callee.name === 'setInterval') {
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
  let target: NodePath | null = path;
  while (target) {
    if (
      t.isExpressionStatement(target.node) ||
      t.isVariableDeclaration(target.node) ||
      t.isFunctionDeclaration(target.node) ||
      t.isStatement(target.node)
    ) {
      (target as unknown as {_remove?: boolean})._remove = true;
      return;
    }
    target = target.parentPath;
  }
  (path as unknown as {_remove?: boolean})._remove = true;
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

// ============== Public pure functions ==============

/**
 * 代码解混淆（v_jstools 风格）。
 *
 * 纯函数：对 JS 代码执行 AST 转换，不依赖 MCP Tool 框架。
 */
export function deobfuscateCode(params: DeobfuscateParams): DeobfuscateResult {
  const {code, mode, clearExtra, clearUnused} = params;

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

    return {
      success: true,
      message: '代码解混淆完成',
      tooltype: 'deobfuscate_code_vj',
      result,
      origLines,
      resultLines,
      origBytes,
      resultBytes,
    };
  } catch (error) {
    return {
      success: false,
      message: `解混淆失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'deobfuscate_code_vj',
      result: code,
      origLines: code.split('\n').length,
      resultLines: code.split('\n').length,
      origBytes: new TextEncoder().encode(code).length,
      resultBytes: new TextEncoder().encode(code).length,
    };
  }
}

/**
 * 代码压缩/格式化。
 *
 * 纯函数：使用 Terser 处理代码，不依赖 MCP Tool 框架。
 */
export async function minifyCodeFn(
  params: MinifyParams,
): Promise<MinifyResult> {
  const {code, action} = params;

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

    return {
      success: true,
      message: `代码${action === 'format' ? '格式化' : '压缩'}完成`,
      tooltype: 'minify_code',
      result,
      origBytes,
      resultBytes,
      reduction,
    };
  } catch (error) {
    return {
      success: false,
      message: `处理失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'minify_code',
      result: code,
      origBytes: new TextEncoder().encode(code).length,
      resultBytes: new TextEncoder().encode(code).length,
      reduction: '0',
    };
  }
}

/**
 * 代码转译。
 *
 * 纯函数：使用 Babel 解析并重新生成代码，不依赖 MCP Tool 框架。
 */
export function transpileCode(params: TranspileParams): TranspileResult {
  const {code} = params;

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

    const {code: result} = generator(ast, {
      jsescOption: {minimal: true},
    });

    return {
      success: true,
      message: '代码转译完成',
      tooltype: 'transpile_code',
      result,
    };
  } catch (error) {
    return {
      success: false,
      message: `转译失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'transpile_code',
      result: code,
    };
  }
}

/**
 * AST 分析。
 *
 * 纯函数：解析 JS 代码并返回 AST 结构信息，不依赖 MCP Tool 框架。
 */
export function analyzeAst(params: AnalyzeAstParams): AnalyzeAstResult {
  const {code, detail, filterType} = params;

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

      return {
        success: true,
        message: 'AST 完整分析完成',
        tooltype: 'analyze_ast',
        fullAst,
      };
    }

    if (filterType) {
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

      return {
        success: true,
        message: `找到 ${nodes.length} 个 "${filterType}" 节点`,
        tooltype: 'analyze_ast',
        filteredNodes: nodes,
      };
    }

    // Summary mode
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

    traverse(ast, visitor);

    return {
      success: true,
      message: 'AST 概要分析完成',
      tooltype: 'analyze_ast',
      stats,
      identifiers,
      functions,
    };
  } catch (error) {
    return {
      success: false,
      message: `AST 分析失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'analyze_ast',
    };
  }
}

/**
 * 代码对比。
 *
 * 纯函数：对比两段文本的差异，不依赖 MCP Tool 框架。
 */
export async function diffCodeFn(params: DiffParams): Promise<DiffResult> {
  const {text1, text2} = params;

  try {
    const {
      createTwoFilesPatch,
      diffLines,
    } = await import('diff');

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

    return {
      success: true,
      message: '代码对比完成',
      tooltype: 'diff_code',
      diff: unifiedDiff,
      addedLines,
      removedLines,
    };
  } catch (error) {
    return {
      success: false,
      message: `对比失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'diff_code',
      diff: '',
      addedLines: 0,
      removedLines: 0,
    };
  }
}

/** 格式化字节数（工具函数导出） */
export {formatBytes};
