/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * BabelPackEnhancer — 从 decodeObfuscator-main/tools/babel_pack.js 迁移的增强反混淆能力
 *
 * 包含以下 babel_pack.js 中独有的、现有反混淆管线尚未覆盖的 AST 变换：
 *   1. keyToLiteral            — 将 obj.key 标准化为 obj["key"]
 *   2. varDeclarToFuncDeclar   — 将 var f = function(){} 提升为 function f(){}
 *   3. DeclaratorToDeclaration — 拆分多声明 VariableDeclaration
 *   4. deleteRepeatDefine      — 移除冗余的 const 重绑定 (var _0xabc = _0xdef)
 *   5. preDecodeObject         — 将分散的 obj["k"] = v 语句合并到 ObjectExpression 中
 *   6. decodeObject            — 将 obj["key"] 查表替换为内联字面量
 *   7. deleteObfuscatorCode    — 清理残留的混淆器基础设施代码
 *   8. callExpressToLiteral    — 利用 VM 沙箱执行混淆器自带解码函数，批量还原混淆调用
 *
 * 所有 pass 均遵循 AstPass 约定: (ast) => {ast, changed}
 */

import vm from 'node:vm';

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import type {
  NodePath as BabelNodePath,
  Scope as BabelScope,
} from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from './astUtils.js';
import {SandboxEvaluator} from './SandboxEvaluator.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> = BabelNodePath<T>;

// ==================== 1. keyToLiteral ====================

/**
 * 将 obj.key 标准化为 obj["key"] (computed member expression)
 * 这样做后，后续 decodeObject 可以更容易地匹配字符串键
 */
export function keyToLiteral(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;

  traverse(ast, {
    MemberExpression: {
      exit(path) {
        const node = path.node;
        if (!node.computed && t.isIdentifier(node.property)) {
          node.property = t.stringLiteral(node.property.name);
          node.computed = true;
          changed = true;
        }
      },
    },
    ObjectProperty: {
      exit(path) {
        const node = path.node;
        if (!node.computed && t.isIdentifier(node.key)) {
          node.key = t.stringLiteral(node.key.name);
          node.shorthand = false;
          changed = true;
        }
      },
    },
  });

  return {ast, changed};
}

// ==================== 2. varDeclarToFuncDeclar ====================

/**
 * 将 var f = function(){} 转换为 function f(){}
 * 提升可读性，方便后续作用域分析
 */
export function varDeclarToFuncDeclar(ast: t.File): {
  ast: t.File;
  changed: boolean;
} {
  let changed = false;

  traverse(ast, {
    VariableDeclarator(path) {
      const {node, parentPath} = path;
      if (parentPath.parentPath?.isFor() || !t.isIdentifier(node.id)) {
        return;
      }
      if (!t.isFunctionExpression(node.init, {id: null})) {
        return;
      }
      const {params, body} = node.init;
      const newNode = t.functionDeclaration(node.id, params, body);
      (parentPath as NodePath<t.VariableDeclaration>).replaceWith(newNode);
      changed = true;
      // Scope needs update after replacement
      path.scope.crawl();
    },
  });

  return {ast, changed};
}

// ==================== 3. DeclaratorToDeclaration ====================

/**
 * 拆分多声明 VariableDeclaration 为单声明形式
 * var a = 1, b = 2 → var a = 1; var b = 2
 */
export function declaratorToDeclaration(ast: t.File): {
  ast: t.File;
  changed: boolean;
} {
  let changed = false;

  traverse(ast, {
    VariableDeclaration(path) {
      const {node, parentPath} = path;

      if (parentPath.parentPath?.isFor()) return;

      const {declarations, kind} = node;
      if (declarations.length <= 1) return;

      const newDeclarations = declarations.map(decl =>
        t.variableDeclaration(kind, [decl]),
      );
      path.replaceWithMultiple(newDeclarations);
      changed = true;
    },
  });

  return {ast, changed};
}

// ==================== 4. deleteRepeatDefine ====================

/**
 * 移除冗余常量重绑定: var _0x123 = _0x456 (常量链传递)
 * 直接重命名引用到源头变量
 */
export function deleteRepeatDefine(ast: t.File): {
  ast: t.File;
  changed: boolean;
} {
  let changed = false;

  traverse(ast, {
    'VariableDeclarator|FunctionDeclaration'(path) {
      const {node} = path;
      let scope = path.scope;

      if (path.isFunctionDeclaration()) {
        scope = path.parentPath.scope;
      }

      const rawNode = node as t.VariableDeclarator | t.FunctionDeclaration;
      const name = t.isIdentifier(rawNode.id) ? rawNode.id.name : undefined;
      if (!name) return;

      const binding = scope.getBinding(name);

      if (path.isFunctionDeclaration()) {
        if (!binding || binding.constantViolations.length > 1) return;
      } else {
        if (!binding || !binding.constant) return;
      }

      scope.traverse(scope.block, {
        VariableDeclarator(innerPath) {
          const {id, init} = innerPath.node;
          if (!t.isIdentifier(init, {name})) return;
          if (!t.isIdentifier(id)) return;

          const innerBinding = innerPath.scope.getBinding(id.name);
          if (!innerBinding || !innerBinding.constant) return;

          innerPath.scope.rename(id.name, name);
          innerPath.remove();
        },
      });

      scope.crawl();
      changed = true;
    },
  });

  return {ast, changed};
}

// ==================== 5. preDecodeObject ====================

/**
 * 将分散的 obj["key"] = value 赋值语句合并到原始 ObjectExpression 中
 *
 * 处理混淆器生成的模式:
 *   var _0x123 = {};
 *   _0x123["a"] = "hello";
 *   _0x123["b"] = "world";
 *   → var _0x123 = { a: "hello", b: "world" };
 */
export function preDecodeObject(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;

  traverse(ast, {
    VariableDeclarator(path) {
      const {id, init} = path.node;
      if (!t.isIdentifier(id) || !t.isObjectExpression(init)) return;

      const name = id.name;
      const properties = init.properties;
      const parentPath = path.parentPath;
      const allNextSiblings = parentPath.getAllNextSiblings();

      if (!allNextSiblings || allNextSiblings.length === 0) return;

      for (const nextSibling of allNextSiblings) {
        if (!nextSibling.isExpressionStatement()) break;

        const expression = (nextSibling as NodePath<t.ExpressionStatement>).get(
          'expression',
        ) as NodePath;
        if (!expression.isAssignmentExpression({operator: '='})) break;

        const {left, right} = expression.node as t.AssignmentExpression;
        if (!t.isMemberExpression(left)) break;

        const {object, property} = left;
        if (!t.isIdentifier(object, {name}) || !t.isStringLiteral(property)) {
          break;
        }

        properties.push(t.objectProperty(property, right));
        nextSibling.remove();
        changed = true;
      }

      if (changed) path.scope.crawl();
    },
  });

  return {ast, changed};
}

// ==================== 6. decodeObject ====================

/**
 * 将 obj["key"] 成员访问替换为内联字面量
 *
 * 当对象的所有属性值都是常量时（字面量或简单函数），
 * 将所有 obj["key"] 引用替换为实际的值。
 * 支持字符串值、二元/逻辑运算符包装、以及 CallExpression 模式。
 */
export function decodeObject(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;

  traverse(ast, {
    VariableDeclarator(path) {
      const {id, init} = path.node;
      if (!t.isIdentifier(id) || !t.isObjectExpression(init)) return;

      const name = id.name;
      const binding = path.scope.getBinding(name);
      if (!binding || !binding.constant) return;

      const properties = init.properties;
      if (properties.length === 0) return;

      // 构建键->值映射
      const valueMap = new Map<string, string | t.Expression>();
      try {
        buildPropertiesMap(properties, valueMap);
      } catch {
        return;
      }
      if (valueMap.size !== properties.length) return;

      // 替换引用
      try {
        const replaced = replaceObjectReferences(
          valueMap,
          binding.referencePaths as Array<NodePath<t.Identifier>>,
        );
        if (replaced) changed = true;
      } catch {
        // 替换失败则跳过，不中断
      }

      valueMap.clear();
    },
  });

  return {ast, changed};
}

function checkCallParams(
  params: t.Identifier[],
  callee: t.Node,
  args: t.Node[],
): boolean {
  if (params.length === 0) return false;
  if (!t.isIdentifier(callee, {name: params[0].name})) return false;
  if (args.length !== params.length - 1) return false;
  for (let i = 1; i < params.length; i++) {
    const arg = args[i - 1];
    if (!t.isIdentifier(arg, {name: params[i].name})) return false;
  }
  return true;
}

function checkBinaryParams(
  paramNames: string[],
  left: t.Node,
  right: t.Node,
): boolean {
  if (paramNames.length !== 2) return false;
  return (
    t.isIdentifier(left, {name: paramNames[0]}) &&
    t.isIdentifier(right, {name: paramNames[1]})
  );
}

function buildPropertiesMap(
  properties: Array<t.ObjectMethod | t.ObjectProperty | t.SpreadElement>,
  valueMap: Map<string, string | t.Expression>,
): void {
  for (const prop of properties) {
    if (!t.isObjectProperty(prop) || !prop.key) {
      throw new Error('unsupported property');
    }

    const propKey = t.isStringLiteral(prop.key) ? prop.key.value : undefined;
    if (propKey === undefined) throw new Error('non-string key');

    if (t.isStringLiteral(prop.value)) {
      valueMap.set(propKey, 'literal:' + prop.value.value);
    } else if (t.isFunctionExpression(prop.value)) {
      const params = prop.value.params;
      if (!params.every(p => t.isIdentifier(p))) {
        throw new Error('unsupported parameters');
      }
      const paramNames = params.map(p => (p as t.Identifier).name);

      const retState = prop.value.body.body;
      if (
        retState.length === 1 &&
        t.isReturnStatement(retState[0]!) &&
        retState[0].argument
      ) {
        const argument = retState[0].argument;
        if (t.isCallExpression(argument)) {
          if (
            !checkCallParams(
              params as t.Identifier[],
              argument.callee,
              argument.arguments,
            )
          ) {
            throw new Error('unsupported call wrapper mapping');
          }
          valueMap.set(propKey, 'Call');
        } else if (
          t.isBinaryExpression(argument) ||
          t.isLogicalExpression(argument)
        ) {
          if (!checkBinaryParams(paramNames, argument.left, argument.right)) {
            throw new Error('unsupported binary wrapper mapping');
          }
          valueMap.set(propKey, argument.operator);
        } else {
          throw new Error('unsupported function body');
        }
      } else {
        throw new Error('unsupported function');
      }
    } else {
      throw new Error('unsupported value type');
    }
  }
}

function replaceObjectReferences(
  valueMap: Map<string, string | t.Expression>,
  referencePaths: Array<NodePath<t.Identifier>>,
): boolean {
  let anyReplaced = false;

  for (const referPath of referencePaths) {
    const parent = referPath.parent as t.Node | undefined;
    const parentPath = referPath.parentPath as NodePath | undefined;
    if (!parent || !parentPath) continue;

    if (!parentPath.isMemberExpression({object: referPath.node})) continue;

    const propNode = (parent as t.MemberExpression).property;
    if (!t.isStringLiteral(propNode)) continue;

    const propKey = propNode.value;
    const propValue = valueMap.get(propKey);
    if (!propValue) continue;

    const ancestorPath = parentPath.parentPath as NodePath | undefined;
    if (!ancestorPath) continue;

    if (typeof propValue === 'string' && propValue.startsWith('literal:')) {
      const literalValue = propValue.slice('literal:'.length);
      parentPath.replaceWith(t.stringLiteral(literalValue));
      anyReplaced = true;
    } else if (propValue === 'Call') {
      if (ancestorPath.isCallExpression({callee: parent})) {
        const args = (ancestorPath.node as t.CallExpression).arguments;
        const firstArg = args[0];
        const restArgs = args.slice(1);
        if (firstArg) {
          ancestorPath.replaceWith(
            t.callExpression(
              firstArg as t.Expression,
              restArgs as t.Expression[],
            ),
          );
          anyReplaced = true;
        }
      }
    } else if (propValue === '||' || propValue === '&&') {
      if (ancestorPath.isCallExpression({callee: parent})) {
        const args = (ancestorPath.node as t.CallExpression).arguments;
        if (args.length >= 2 && args[0] && args[1]) {
          ancestorPath.replaceWith(
            t.logicalExpression(
              propValue,
              args[0] as t.Expression,
              args[1] as t.Expression,
            ),
          );
          anyReplaced = true;
        }
      }
    } else {
      // Binary operator
      if (ancestorPath.isCallExpression({callee: parent})) {
        const args = (ancestorPath.node as t.CallExpression).arguments;
        if (args.length >= 2 && args[0] && args[1]) {
          ancestorPath.replaceWith(
            t.binaryExpression(
              propValue as t.BinaryExpression['operator'],
              args[0] as t.Expression,
              args[1] as t.Expression,
            ),
          );
          anyReplaced = true;
        }
      }
    }
  }

  return anyReplaced;
}

// ==================== 7. deleteObfuscatorCode ====================

/**
 * 清理残留的混淆器基础设施代码:
 *   - constructor/RegExp 包装器
 *   - debugger 保护 iframe
 *   - setInterval 垃圾代码注入
 *   - OAEP apply 包装器等
 */
export function deleteObfuscatorCode(ast: t.File): {
  ast: t.File;
  changed: boolean;
} {
  let changed = false;

  traverse(ast, {
    VariableDeclarator(path) {
      const sourceCode = path.toString();
      const {id, init} = path.node;

      if (t.isCallExpression(init)) {
        const {callee, arguments: args} = init;
        // 无参数 apply 包装器
        if (args.length === 0 && sourceCode.includes('apply')) {
          path.remove();
          changed = true;
          return;
        }
        // constructor + RegExp + 自执行函数
        if (
          (sourceCode.includes('constructor') ||
            sourceCode.includes('RegExp')) &&
          t.isIdentifier(callee) &&
          args.length === 2 &&
          t.isThisExpression(args[0]) &&
          t.isFunctionExpression(args[1])
        ) {
          if (!t.isIdentifier(id)) return;
          const funcName = id.name;
          const nextSibling = path.parentPath.getNextSibling();
          if (nextSibling.isExpressionStatement()) {
            const expression = (
              nextSibling as NodePath<t.ExpressionStatement>
            ).get('expression') as NodePath;
            if (
              expression.isCallExpression() &&
              (expression.get('callee') as NodePath).isIdentifier({
                name: funcName,
              })
            ) {
              path.remove();
              nextSibling.remove();
              changed = true;
              return;
            }
          }
        }
      }
    },
    ExpressionStatement(path) {
      const {expression} = path.node;
      if (!t.isCallExpression(expression)) return;

      const {callee, arguments: args} = expression;
      if (!t.isFunctionExpression(callee) || args.length !== 0) return;

      const sourceCode = path.toString();
      if (
        (sourceCode.includes('RegExp') && sourceCode.includes('chain')) ||
        (sourceCode.includes('constructor') &&
          sourceCode.includes('setInterval'))
      ) {
        path.remove();
        changed = true;
      }
    },
    CallExpression(path) {
      const {node, scope} = path;
      const {callee, arguments: args} = node;
      if (!t.isIdentifier(callee, {name: 'setInterval'})) return;

      if (
        args.length !== 2 ||
        !t.isFunctionExpression(args[0]) ||
        !t.isNumericLiteral(args[1])
      ) {
        return;
      }

      const body = args[0].body.body;
      if (body.length !== 1 || !t.isExpressionStatement(body[0]!)) return;

      const innerExpr = (body[0] as t.ExpressionStatement).expression;
      if (!t.isCallExpression(innerExpr)) return;

      const innerCallee = innerExpr.callee;
      const innerArgs = innerExpr.arguments;
      if (!t.isIdentifier(innerCallee) || innerArgs.length !== 0) return;

      const binding = scope.getBinding(innerCallee.name);
      if (!binding?.path) return;

      const bindingSource = binding.path.toString();
      if (
        bindingSource.includes('constructor') ||
        bindingSource.includes('debugger')
      ) {
        path.remove();
        binding.path.remove();
        changed = true;
      }
    },
    FunctionDeclaration(path) {
      const body = path.node.body.body;
      if (
        body.length === 2 &&
        t.isFunctionDeclaration(body[0]!) &&
        t.isTryStatement(body[1]!)
      ) {
        const sourceCode = path.toString();
        if (
          sourceCode.includes('constructor') &&
          sourceCode.includes('debugger') &&
          sourceCode.includes('apply')
        ) {
          path.remove();
          changed = true;
        }
      }
    },
  });

  return {ast, changed};
}

// ==================== 8. callExpressToLiteral ====================

export interface CallExpressToLiteralOptions {
  /** VM 沙箱执行解码器代码的超时（毫秒），默认 5000 */
  vmTimeoutMs?: number;
  /** 单次 evaluateExpression 求值的超时（毫秒），默认 1000 */
  evalTimeoutMs?: number;
}

/**
 * 利用 VM 沙箱执行混淆器自带解码函数，批量还原混淆调用
 *
 * 这是 babel_pack.js 中最核心的能力:
 *   1. 识别字符串数组引用 → 查找关联的解码函数
 *   2. 提取解码器代码并重组为可执行片段
 *   3. 在 VM 沙箱中执行解码器
 *   4. 遍历所有混淆调用，用沙箱求值结果替换为字面量
 *   5. 删除已无用的混淆器代码
 *
 * 比现有 StringDecryptionStrategy 更强的地方:
 *   - 能处理多函数交叉引用的复杂解码器模式
 *   - 使用 eval 穷尽求值而非静态分析
 *   - 自动识别并清理所有关联的混淆器基础设施
 *
 * @returns 返回符合 AstPass 约定的 pass 函数
 */
export function callExpressToLiteral(
  options?: CallExpressToLiteralOptions,
): (ast: t.File) => {ast: t.File; changed: boolean} {
  const vmTimeoutMs = options?.vmTimeoutMs ?? 5000;
  const evalTimeoutMs = options?.evalTimeoutMs ?? 1000;

  return function callExpressToLiteralPass(ast: t.File): {
    ast: t.File;
    changed: boolean;
  } {
    let changed = false;

    traverse(ast, {
      VariableDeclarator(path) {
        const {node, scope} = path;
        const {id, init} = node;
        if (!t.isIdentifier(id)) return;

        // 检测字符串数组声明
        if (
          !t.isArrayExpression(init) ||
          !init.elements.every(el => t.isStringLiteral(el))
        ) {
          return;
        }

        const binding = scope.getBinding(id.name);
        if (!binding?.constant) return;

        // 收集混淆器函数路径
        const funcNames: string[] = [];
        const removedPaths: NodePath[] = [];

        if (binding.referencePaths.length !== 1) return;
        const referPath = binding.referencePaths[0];
        if (!referPath) return;
        const {node: refNode, parentPath: refParent} = referPath;
        if (!refParent.isReturnStatement({argument: refNode})) return;

        const obfuscatorPaths = getObfuscatorPaths(path, funcNames);
        scope.crawl();

        if (!obfuscatorPaths || obfuscatorPaths.length < 3) return;

        // 重组解码器代码
        let obfuscatorCode = '';
        for (const eachPath of obfuscatorPaths) {
          obfuscatorCode += eachPath.toString() + ';\n';
        }
        obfuscatorCode += getRedefineFunctions(
          path.getFunctionParent()?.parentPath.scope || path.scope,
          funcNames,
          removedPaths,
        );

        // 压缩解码器代码
        try {
          const funcAst = parser.parse(obfuscatorCode, {
            sourceType: 'module',
            plugins: ['jsx'],
          });
          obfuscatorCode = generate(funcAst, {compact: true}).code;
        } catch {
          return;
        }

        // 在 VM 沙箱中执行解码器
        const sandboxEval = new SandboxEvaluator();
        const sandbox = sandboxEval.createSandbox();
        try {
          vm.runInNewContext(obfuscatorCode, sandbox, {timeout: vmTimeoutMs});
        } catch {
          return;
        }

        // 收集解码函数的位置信息
        const nameRanges: Array<{start: number; end: number; name: string}> =
          [];
        for (const name of funcNames) {
          const funcBinding = scope.getBinding(name);
          if (!funcBinding) continue;
          const {start, end} = funcBinding.path.node;
          if (typeof start === 'number' && typeof end === 'number') {
            nameRanges.push({start, end, name});
          }
        }

        // 遍历并替换所有混淆调用
        let canRemove = true;
        scope.traverse(scope.block, {
          CallExpression(callPath) {
            const callNode = callPath.node;

            // 跳过解码器函数定义内部的调用
            for (const range of nameRanges) {
              if (
                typeof callNode.start === 'number' &&
                callNode.start > range.start &&
                typeof callNode.end === 'number' &&
                callNode.end < range.end
              ) {
                return;
              }
            }

            const {callee, arguments: args} = callNode;
            if (!t.isIdentifier(callee) || args.length === 0) return;
            if (!funcNames.includes(callee.name)) return;

            // 验证所有参数都是字面量
            if (!isElementsLiteral(callPath)) {
              canRemove = false;
              return;
            }

            // 在沙箱中求值
            try {
              const value = sandboxEval.evaluateExpression(
                callPath.toString(),
                sandbox,
                evalTimeoutMs,
              );
              if (value.ok && value.value !== undefined) {
                callPath.replaceWith(t.valueToNode(value.value));
                changed = true;
              }
            } catch {
              canRemove = false;
            }
          },
        });

        // 如果所有调用都已内联，删除解码器
        if (canRemove) {
          for (const eachPath of obfuscatorPaths) {
            eachPath.remove();
          }
          for (const eachPath of removedPaths) {
            eachPath.remove();
          }
        }

        scope.crawl();
      },
    });

    return {ast, changed};
  }; // end callExpressToLiteralPass
}

// ==================== 辅助函数 ====================

function isBaseLiteral(path: NodePath): boolean {
  if (path.isLiteral()) return true;
  if (
    path.isUnaryExpression({operator: '-'}) ||
    path.isUnaryExpression({operator: '+'})
  ) {
    return isBaseLiteral(path.get('argument') as NodePath);
  }
  return false;
}

function isElementsLiteral(path: NodePath<t.CallExpression>): boolean {
  let key: string;
  if (path.isArrayExpression()) {
    key = 'elements';
  } else if (path.isObjectExpression()) {
    key = 'properties';
  } else if (path.isCallExpression()) {
    key = 'arguments';
  } else {
    return isBaseLiteral(path);
  }

  const elements = path.get(key as never) as NodePath[];
  if (elements.length === 0) return false;

  if (key === 'properties') {
    return elements.every(el => isBaseLiteral(el.get('value') as NodePath));
  }
  return elements.every(el => isBaseLiteral(el));
}

function getObfuscatorPaths(
  path: NodePath<t.VariableDeclarator>,
  funcNames: string[],
): NodePath[] | undefined {
  const functionParent = path.getFunctionParent();
  if (!functionParent) return undefined;

  const {node, scope: funcScope} = functionParent;
  const name = t.isFunctionDeclaration(node) ? node.id?.name : undefined;
  if (!name) return undefined;

  const binding = funcScope.parent.getBinding(name);
  if (!binding || binding.referencePaths.length < 2) return undefined;

  const obfuscatorPaths: NodePath[] = [functionParent];

  for (const referPath of binding.referencePaths) {
    const ancestorPath =
      referPath.findParent(p => p.isFunctionDeclaration()) ||
      referPath.findParent(p => p.isCallExpression());

    if (!ancestorPath) return undefined;

    if (ancestorPath.isFunctionDeclaration()) {
      const id = (ancestorPath.get('id') as NodePath<t.Identifier>).node?.name;
      if (id) funcNames.push(id);
    } else {
      const ancestorNode = ancestorPath.node as t.CallExpression;
      const args = ancestorNode.arguments;
      if (
        args.length < 2 ||
        !t.isIdentifier(args[0]!, {name}) ||
        !t.isNumericLiteral(args[1])
      ) {
        return undefined;
      }
      if (
        !t.isExpressionStatement(ancestorPath.parent) ||
        ancestorPath.parent.expression !== ancestorNode
      ) {
        return undefined;
      }
    }

    if (!obfuscatorPaths.includes(ancestorPath)) {
      obfuscatorPaths.push(ancestorPath);
    }
  }

  return obfuscatorPaths;
}

function getRedefineFunctions(
  scope: BabelScope,
  funcNames: string[],
  removedPaths: NodePath[],
): string {
  // Fallback to simple scope traversal
  let decodeCode = '';

  scope.traverse(scope.block, {
    FunctionDeclaration(path) {
      const {id, body, params} = path.node;
      if (!id) return;
      if (params.length !== 4 && params.length !== 5) return;

      const bodyStatements = body.body;
      if (
        !bodyStatements ||
        bodyStatements.length !== 1 ||
        !t.isReturnStatement(bodyStatements[0]!)
      ) {
        return;
      }

      const argument = bodyStatements[0].argument;
      if (
        !argument ||
        !t.isCallExpression(argument) ||
        !t.isIdentifier(argument.callee)
      ) {
        return;
      }

      decodeCode += path.toString();
      funcNames.push(id.name);
      removedPaths.push(path);
    },
  });

  return decodeCode;
}

// ==================== 组合 Pass ====================

/**
 * 结构化增强 Pass: 提升代码结构可读性
 * 组合: DeclaratorToDeclaration + varDeclarToFuncDeclar + keyToLiteral + deleteRepeatDefine
 */
export function structuralEnhance(ast: t.File): {
  ast: t.File;
  changed: boolean;
} {
  let changed = false;

  const passes = [
    declaratorToDeclaration,
    varDeclarToFuncDeclar,
    keyToLiteral,
    deleteRepeatDefine,
  ];

  for (const pass of passes) {
    const result = pass(ast);
    if (result.changed) changed = true;
  }

  return {ast, changed};
}

/**
 * 对象解码 Pass: 合并分散属性 + 内联常量查询
 * 组合: preDecodeObject + decodeObject
 */
export function objectDecode(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;

  const r0 = keyToLiteral(ast);
  if (r0.changed) changed = true;

  const r1 = preDecodeObject(ast);
  if (r1.changed) changed = true;

  const r2 = decodeObject(ast);
  if (r2.changed) changed = true;

  return {ast, changed};
}

/**
 * 清理 Pass: 删除混淆器残留代码
 */
export function cleanupObfuscator(ast: t.File): {
  ast: t.File;
  changed: boolean;
} {
  let changed = false;

  const r1 = deleteRepeatDefine(ast);
  if (r1.changed) changed = true;

  const r2 = deleteObfuscatorCode(ast);
  if (r2.changed) changed = true;

  return {ast, changed};
}
