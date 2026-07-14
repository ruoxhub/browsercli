/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 字符串解密策略
 *
 * 处理所有字符串数组 / 解码器相关的反混淆步骤：
 *   - 字符串解码 (hex / unicode)
 *   - 字符串数组提取 (JavaScript Obfuscator 特有)
 *   - 字符串数组引用替换
 *   - 内联解码包装函数
 *   - VM 沙箱求值解码器调用
 */

import vm from 'node:vm';

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import type {Transformation} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

import {unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

// ==================== 辅助函数 ====================

function getStaticNumber(node: t.Node | null | undefined): number | null {
  if (!node) return null;
  if (t.isNumericLiteral(node)) return node.value;
  if (
    t.isUnaryExpression(node, {operator: '-'}) &&
    t.isNumericLiteral(node.argument)
  ) {
    return -node.argument.value;
  }
  return null;
}

function isObfuscatorIdentifier(name: string): boolean {
  return /^_0x[a-z0-9]+$/i.test(name);
}

function isStaticVmArg(node: t.Node): node is t.Expression {
  if (
    t.isNumericLiteral(node) ||
    t.isStringLiteral(node) ||
    t.isBooleanLiteral(node)
  ) {
    return true;
  }

  return (
    t.isUnaryExpression(node, {operator: '-'}) &&
    (t.isNumericLiteral(node.argument) || t.isUnaryExpression(node.argument))
  );
}

// ==================== 策略函数 ====================

/**
 * 字符串解码 (hex / unicode)
 */
export async function decodeStrings(
  code: string,
  transformations: Transformation[],
): Promise<string> {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let decoded = 0;

    traverse(ast, {
      StringLiteral(path) {
        if (path.node.extra) {
          delete path.node.extra;
          decoded++;
        }
      },
    });

    if (decoded > 0) {
      const output = generate(ast, {comments: true, compact: false});
      transformations.push({
        type: 'string-decode',
        description: `Decoded ${decoded} strings (hex/unicode)`,
        success: true,
      });
      return output.code;
    }
    return code;
  } catch (error) {
    logger.warn('String decoding failed', error);
    transformations.push({
      type: 'string-decode',
      description: 'Failed',
      success: false,
    });
    return code;
  }
}

/**
 * 提取字符串数组 (JavaScript Obfuscator 特有)
 */
export async function extractStringArrays(
  code: string,
  transformations: Transformation[],
  stringArrays: Map<string, string[]>,
): Promise<string> {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let extracted = 0;

    traverse(ast, {
      VariableDeclarator: path => {
        if (
          t.isIdentifier(path.node.id) &&
          path.node.id.name.startsWith('_0x') &&
          t.isArrayExpression(path.node.init)
        ) {
          const arrayName = path.node.id.name;
          const strings: string[] = [];
          path.node.init.elements.forEach(el => {
            if (t.isStringLiteral(el)) strings.push(el.value);
          });
          if (strings.length > 0) {
            stringArrays.set(arrayName, strings);
            extracted++;
            logger.debug(
              `Extracted string array: ${arrayName} (${strings.length} strings)`,
            );
          }
        }
      },
    });

    if (extracted > 0) {
      transformations.push({
        type: 'extract-string-arrays',
        description: `Extracted ${extracted} string arrays`,
        success: true,
      });
    }
    return code;
  } catch (error) {
    logger.warn('String array extraction failed', error);
    transformations.push({
      type: 'extract-string-arrays',
      description: 'Failed',
      success: false,
    });
    return code;
  }
}

/**
 * 数组解密 (替换字符串数组引用)
 */
export async function decryptArrays(
  code: string,
  transformations: Transformation[],
  stringArrays: Map<string, string[]>,
): Promise<string> {
  if (stringArrays.size === 0) return code;

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let replaced = 0;
    const arrays = stringArrays;

    traverse(ast, {
      MemberExpression(path) {
        if (
          t.isIdentifier(path.node.object) &&
          t.isNumericLiteral(path.node.property) &&
          path.node.object.name.startsWith('_0x')
        ) {
          const arr = arrays.get(path.node.object.name);
          const idx = path.node.property.value;
          if (arr && idx >= 0 && idx < arr.length) {
            const value = arr[idx];
            if (value !== undefined) {
              path.replaceWith(t.stringLiteral(value));
              replaced++;
            }
          }
        }
      },
    });

    if (replaced > 0) {
      const output = generate(ast, {comments: true, compact: false});
      transformations.push({
        type: 'decrypt-arrays',
        description: `Replaced ${replaced} array references`,
        success: true,
      });
      return output.code;
    }
    return code;
  } catch (error) {
    logger.warn('Array decryption failed', error);
    transformations.push({
      type: 'decrypt-arrays',
      description: 'Failed',
      success: false,
    });
    return code;
  }
}

/**
 * 内联 javascript-obfuscator 常见的字符串解码包装函数
 */
export async function inlineStringDecoderCalls(
  code: string,
  transformations: Transformation[],
): Promise<string> {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    const providers = new Map<string, string[]>();
    const decoders = new Map<string, {strings: string[]; offset: number}>();
    let replaced = 0;

    traverse(ast, {
      FunctionDeclaration: path => {
        const name = path.node.id?.name;
        if (!name) return;

        const providerStrings = extractArrayProviderStrings(path.node);
        if (providerStrings) {
          providers.set(name, providerStrings);
          return;
        }

        const decoder = extractStringDecoder(path.node, providers);
        if (decoder) {
          decoders.set(name, decoder);
        }
      },
    });

    traverse(ast, {
      CallExpression(path) {
        if (!t.isIdentifier(path.node.callee)) return;

        const decoder = decoders.get(path.node.callee.name);
        if (!decoder) return;
        if (path.node.arguments.length === 0) return;

        const firstArg = path.node.arguments[0];
        const index = getStaticNumber(firstArg);
        if (index === null) return;

        const resolved = decoder.strings[index - decoder.offset];
        if (resolved === undefined) return;

        path.replaceWith(t.stringLiteral(resolved));
        replaced++;
      },

      MemberExpression(path) {
        if (
          path.node.computed &&
          t.isStringLiteral(path.node.property) &&
          t.isValidIdentifier(path.node.property.value)
        ) {
          path.node.computed = false;
          path.node.property = t.identifier(path.node.property.value);
        }
      },
    });

    if (replaced > 0) {
      const output = generate(ast, {comments: true, compact: false});
      transformations.push({
        type: 'inline-string-decoders',
        description: `Inlined ${replaced} string decoder calls`,
        success: true,
      });
      return output.code;
    }

    return code;
  } catch (error) {
    logger.warn('String decoder inlining failed', error);
    transformations.push({
      type: 'inline-string-decoders',
      description: 'Failed',
      success: false,
    });
    return code;
  }
}

/**
 * 通过受限 vm 静态求值更复杂的 javascript-obfuscator 解码器调用
 */
export async function evaluateStringDecoderCalls(
  code: string,
  transformations: Transformation[],
): Promise<string> {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    const helperCode = buildDecoderHelperPrelude(ast.program.body);
    if (!helperCode) {
      return code;
    }

    const context = vm.createContext({
      parseInt,
      decodeURIComponent,
      String,
      Array,
      Number,
      Boolean,
      Math,
      Buffer,
      atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
      btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'),
    });

    new vm.Script(helperCode).runInContext(context, {timeout: 100});

    let replaced = 0;
    traverse(ast, {
      CallExpression: path => {
        if (!t.isIdentifier(path.node.callee)) return;
        if (!isObfuscatorIdentifier(path.node.callee.name)) return;
        if (!path.node.arguments.every(isStaticVmArg)) return;

        const expression = generate(path.node, {compact: true}).code;
        let evaluated: unknown;
        try {
          evaluated = new vm.Script(expression).runInContext(context, {
            timeout: 50,
          });
        } catch {
          return;
        }

        if (typeof evaluated === 'string') {
          path.replaceWith(t.stringLiteral(evaluated));
          replaced++;
          return;
        }

        if (typeof evaluated === 'number') {
          path.replaceWith(t.numericLiteral(evaluated));
          replaced++;
        }
      },

      MemberExpression(path) {
        if (
          path.node.computed &&
          t.isStringLiteral(path.node.property) &&
          t.isValidIdentifier(path.node.property.value)
        ) {
          path.node.computed = false;
          path.node.property = t.identifier(path.node.property.value);
        }
      },
    });

    if (replaced > 0) {
      const output = generate(ast, {comments: true, compact: false});
      transformations.push({
        type: 'evaluate-string-decoders',
        description: `Evaluated ${replaced} decoder calls in sandbox`,
        success: true,
      });
      return output.code;
    }

    return code;
  } catch (error) {
    logger.warn('Decoder sandbox evaluation failed', error);
    transformations.push({
      type: 'evaluate-string-decoders',
      description: 'Failed',
      success: false,
    });
    return code;
  }
}

// ==================== 内部辅助 ====================

function buildDecoderHelperPrelude(body: t.Statement[]): string | null {
  const helperStatements: string[] = [];

  for (const statement of body) {
    if (
      t.isFunctionDeclaration(statement) &&
      statement.id &&
      isObfuscatorIdentifier(statement.id.name)
    ) {
      helperStatements.push(generate(statement, {compact: true}).code);
      continue;
    }

    if (t.isVariableDeclaration(statement)) {
      const hasHelperDeclarator = statement.declarations.some(declaration => {
        if (!t.isIdentifier(declaration.id)) return false;
        if (isObfuscatorIdentifier(declaration.id.name)) return true;

        return (
          t.isIdentifier(declaration.init) &&
          isObfuscatorIdentifier(declaration.init.name)
        );
      });

      if (hasHelperDeclarator) {
        helperStatements.push(generate(statement, {compact: true}).code);
      }
      continue;
    }

    if (
      t.isExpressionStatement(statement) &&
      t.isCallExpression(statement.expression) &&
      statementContainsObfuscatorHelper(statement)
    ) {
      helperStatements.push(generate(statement, {compact: true}).code);
    }
  }

  return helperStatements.length > 0 ? helperStatements.join('\n') : null;
}

function statementContainsObfuscatorHelper(statement: t.Statement): boolean {
  let found = false;

  traverse(
    t.file(t.program([statement])),
    {
      Identifier(path) {
        if (isObfuscatorIdentifier(path.node.name)) {
          found = true;
          path.stop();
        }
      },
    },
    undefined,
    {},
  );

  return found;
}

function extractArrayProviderStrings(
  fn: t.FunctionDeclaration,
): string[] | null {
  const fnName = fn.id?.name;
  if (!fnName) return null;

  let arrayName: string | null = null;
  let strings: string[] | null = null;
  let rebindReturnsArray = false;
  let returnsSelfCall = false;

  for (const statement of fn.body.body) {
    if (t.isVariableDeclaration(statement)) {
      for (const declaration of statement.declarations) {
        if (
          t.isIdentifier(declaration.id) &&
          t.isArrayExpression(declaration.init)
        ) {
          const values = declaration.init.elements.map(element =>
            t.isStringLiteral(element) ? element.value : null,
          );
          if (values.every(value => typeof value === 'string')) {
            arrayName = declaration.id.name;
            strings = values as string[];
          }
        }
      }
      continue;
    }

    if (
      t.isExpressionStatement(statement) &&
      t.isAssignmentExpression(statement.expression, {operator: '='}) &&
      t.isIdentifier(statement.expression.left, {name: fnName}) &&
      t.isFunctionExpression(statement.expression.right)
    ) {
      const innerStatements = statement.expression.right.body.body;
      if (
        innerStatements.length === 1 &&
        t.isReturnStatement(innerStatements[0]) &&
        t.isIdentifier(innerStatements[0].argument) &&
        innerStatements[0].argument.name === arrayName
      ) {
        rebindReturnsArray = true;
      }
      continue;
    }

    if (
      t.isReturnStatement(statement) &&
      t.isCallExpression(statement.argument) &&
      t.isIdentifier(statement.argument.callee, {name: fnName})
    ) {
      returnsSelfCall = true;
    }
  }

  if (strings && arrayName && rebindReturnsArray && returnsSelfCall) {
    return strings;
  }

  return null;
}

function extractStringDecoder(
  fn: t.FunctionDeclaration,
  providers: Map<string, string[]>,
): {strings: string[]; offset: number} | null {
  const fnName = fn.id?.name;
  if (!fnName) return null;

  let backingStrings: string[] | null = null;
  let backingArrayAlias: string | null = null;

  for (const statement of fn.body.body) {
    if (!t.isVariableDeclaration(statement)) continue;
    for (const declaration of statement.declarations) {
      if (
        !t.isIdentifier(declaration.id) ||
        !t.isCallExpression(declaration.init) ||
        !t.isIdentifier(declaration.init.callee)
      ) {
        continue;
      }

      const strings = providers.get(declaration.init.callee.name);
      if (strings) {
        backingStrings = strings;
        backingArrayAlias = declaration.id.name;
      }
    }
  }

  if (!backingStrings || !backingArrayAlias) return null;

  for (const statement of fn.body.body) {
    if (
      !t.isReturnStatement(statement) ||
      !t.isSequenceExpression(statement.argument)
    ) {
      continue;
    }

    const [assignmentExpr] = statement.argument.expressions;
    if (
      !t.isAssignmentExpression(assignmentExpr, {operator: '='}) ||
      !t.isIdentifier(assignmentExpr.left, {name: fnName}) ||
      !t.isFunctionExpression(assignmentExpr.right)
    ) {
      continue;
    }

    const innerFn = assignmentExpr.right;
    const indexParam = innerFn.params[0];
    if (!t.isIdentifier(indexParam)) return null;

    let offset = 0;
    let hasOffsetAssign = false;
    let returnsBackingLookup = false;

    for (const innerStatement of innerFn.body.body) {
      if (
        t.isExpressionStatement(innerStatement) &&
        t.isAssignmentExpression(innerStatement.expression, {operator: '='}) &&
        t.isIdentifier(innerStatement.expression.left, {
          name: indexParam.name,
        }) &&
        t.isBinaryExpression(innerStatement.expression.right, {
          operator: '-',
        }) &&
        t.isIdentifier(innerStatement.expression.right.left, {
          name: indexParam.name,
        })
      ) {
        const numericOffset = getStaticNumber(
          innerStatement.expression.right.right,
        );
        if (numericOffset !== null) {
          offset = numericOffset;
          hasOffsetAssign = true;
        }
        continue;
      }

      if (
        t.isReturnStatement(innerStatement) &&
        t.isMemberExpression(innerStatement.argument, {computed: true}) &&
        t.isIdentifier(innerStatement.argument.object, {
          name: backingArrayAlias,
        }) &&
        t.isIdentifier(innerStatement.argument.property, {
          name: indexParam.name,
        })
      ) {
        returnsBackingLookup = true;
      }
    }

    if (returnsBackingLookup) {
      return {
        strings: backingStrings,
        offset: hasOffsetAssign ? offset : 0,
      };
    }
  }

  return null;
}
