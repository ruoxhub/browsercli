/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 共享的 AST 工具函数（供 AdvancedDeobfuscator、ASTOptimizer、Deobfuscator 共用）。
 *
 * 这里只放纯函数，没有副作用。
 */
import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

const BINARY_RESULT_FNS: Record<string, (l: number, r: number) => number> = {
  '+': (l, r) => l + r,
  '-': (l, r) => l - r,
  '*': (l, r) => l * r,
  '/': (l, r) => l / r,
  '%': (l, r) => l % r,
  '**': (l, r) => l ** r,
  '|': (l, r) => l | r,
  '&': (l, r) => l & r,
  '^': (l, r) => l ^ r,
  '<<': (l, r) => l << r,
  '>>': (l, r) => l >> r,
  '>>>': (l, r) => l >>> r,
};

/**
 * 对两个数字字面量做二元运算，结果有限时返回该数字，否则返回 undefined（例如除以 0）。
 */
export function evalBinaryNumbers(
  left: t.NumericLiteral,
  right: t.NumericLiteral,
  operator: string,
): number | undefined {
  const fn = BINARY_RESULT_FNS[operator];
  if (!fn) return undefined;

  const result = fn(left.value, right.value);
  return Number.isFinite(result) ? result : undefined;
}

/**
 * 把一段代码按行/字节截断到 maxLength，避免喂给 LLM 时超 token。
 */
export function truncateCode(code: string, maxLength: number): string {
  if (code.length <= maxLength) return code;
  return code.substring(0, maxLength) + '\n\n// ... (code truncated)';
}

/**
 * 提取 babel 工具的 default 导出，兼容 CJS / ESM 双形态。
 * （@babel/traverse 和 @babel/generator 在不同打包器下默认导出位置不同。）
 */
export function unwrapBabelDefault<T>(mod: unknown): T {
  const wrapped = mod as {default?: T} | T;
  if (typeof wrapped === 'object' && wrapped !== null && 'default' in wrapped) {
    return (wrapped as {default: T}).default;
  }
  return wrapped as T;
}

/**
 * 从 LLM 响应中提取代码：移除 markdown 代码块标记。
 * 提取自 AdvancedDeobfuscator，供门面与各策略模块共用。
 */
export function extractCodeFromLLMResponse(response: string): string {
  let code = response.trim();
  code = code.replace(/^```(?:javascript|js)?\s*\n/i, '');
  code = code.replace(/\n```\s*$/i, '');
  return code.trim();
}

/**
 * 验证是否是有效的 JavaScript。
 * 提取自 AdvancedDeobfuscator，供门面与各策略模块共用。
 */
export function isValidJavaScript(code: string): boolean {
  try {
    parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 标准化代码格式：移除多余空白字符和注释中的混淆。
 * 提取自 AdvancedDeobfuscator。
 */
export function normalizeCode(code: string): string {
  // Just return the code or do a safe trimming, do not use naive regex replacements
  // that strip comments globally since they break string literals containing '//' or '/*'.
  return code.trim();
}

/**
 * 估算代码复杂度（函数、条件、循环、try-catch 数量加权）。
 * 提取自 AdvancedDeobfuscator。
 */
export function estimateCodeComplexity(code: string): number {
  const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let complexity = 0;

    traverse(ast, {
      // 每个函数增加复杂度
      FunctionDeclaration() {
        complexity += 2;
      },
      FunctionExpression() {
        complexity += 2;
      },
      ArrowFunctionExpression() {
        complexity += 2;
      },

      // 每个条件语句增加复杂度
      IfStatement() {
        complexity += 1;
      },
      SwitchStatement() {
        complexity += 2;
      },
      ConditionalExpression() {
        complexity += 1;
      },

      // 每个循环增加复杂度
      WhileStatement() {
        complexity += 2;
      },
      ForStatement() {
        complexity += 2;
      },
      DoWhileStatement() {
        complexity += 2;
      },

      // 每个 try-catch 增加复杂度
      TryStatement() {
        complexity += 3;
      },
    });

    return complexity;
  } catch {
    // 如果解析失败，返回高复杂度
    return 100;
  }
}

/**
 * 应用 AST 优化（常量折叠、表达式简化、空语句移除、三元简化）。
 * 提取自 AdvancedDeobfuscator。
 */
export function applyASTOptimizations(code: string): string {
  const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
  const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let optimized = 0;

    traverse(ast, {
      // 常量折叠：计算常量表达式
      BinaryExpression(path) {
        const {left, right, operator} = path.node;

        if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
          const result = evalBinaryNumbers(left, right, operator);
          if (result !== undefined) {
            path.replaceWith(t.numericLiteral(result));
            optimized++;
          }
        }
      },

      // 简化逻辑表达式
      LogicalExpression(path) {
        const {left, right, operator} = path.node;

        // true && x => x
        if (
          operator === '&&' &&
          t.isBooleanLiteral(left) &&
          left.value === true
        ) {
          path.replaceWith(right);
          optimized++;
        }

        // false || x => x
        if (
          operator === '||' &&
          t.isBooleanLiteral(left) &&
          left.value === false
        ) {
          path.replaceWith(right);
          optimized++;
        }
      },

      // 移除空语句
      EmptyStatement(path) {
        path.remove();
        optimized++;
      },

      // 简化三元表达式
      ConditionalExpression(path) {
        const {test, consequent, alternate} = path.node;

        if (!t.isBooleanLiteral(test)) return;

        // true ? a : b => a；false ? a : b => b
        path.replaceWith(test.value ? consequent : alternate);
        optimized++;
      },
    });

    if (optimized > 0) {
      return generate(ast, {comments: true, compact: false}).code;
    }

    return code;
  } catch {
    return code;
  }
}
