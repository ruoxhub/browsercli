/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 轻量 JS 语法预检：在不调用 V8 的情况下识别明显不完整的 function 代码。
 *
 * 不是完整的 JS parser，只追踪：
 *   - 字符串（'、"、`，含转义与模板字面量 `${...}` 嵌套）
 *   - 单行 / 块注释
 *   - (), {}, [] 配平
 *
 * 不识别：正则字面量、JSX、半段语义错误（例如缺少表达式）。
 * 这些会在 V8 报错时被原样透传，不会造成误杀。
 */

export interface ScriptSyntaxIssue {
  reason: string;
}

type ScanState =
  | 'normal'
  | 'single-quote'
  | 'double-quote'
  | 'template'
  | 'line-comment'
  | 'block-comment';

export function checkScriptSyntaxBalance(
  code: string,
): ScriptSyntaxIssue | null {
  let state: ScanState = 'normal';
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  // 模板字面量 `${...}` 嵌套：栈中每一项 = 进入 `${` 之后 brace 计数。
  // 当一个 `}` 把 brace 降回该值减一时，表示模板表达式结束。
  const templateBraceStack: number[] = [];

  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const next = code[i + 1];

    switch (state) {
      case 'normal': {
        if (c === '/' && next === '/') {
          state = 'line-comment';
          i++;
          continue;
        }
        if (c === '/' && next === '*') {
          state = 'block-comment';
          i++;
          continue;
        }
        if (c === "'") {
          state = 'single-quote';
          continue;
        }
        if (c === '"') {
          state = 'double-quote';
          continue;
        }
        if (c === '`') {
          state = 'template';
          continue;
        }
        if (c === '(') {
          paren++;
        } else if (c === ')') {
          paren--;
          if (paren < 0) {
            return {
              reason: `多了一个 ')'（位置 ${i + 1}），无对应的 '('`,
            };
          }
        } else if (c === '{') {
          brace++;
        } else if (c === '}') {
          if (
            templateBraceStack.length > 0 &&
            brace === templateBraceStack[templateBraceStack.length - 1]
          ) {
            templateBraceStack.pop();
            brace--;
            state = 'template';
            continue;
          }
          brace--;
          if (brace < 0) {
            return {
              reason: `多了一个 '}'（位置 ${i + 1}），无对应的 '{'`,
            };
          }
        } else if (c === '[') {
          bracket++;
        } else if (c === ']') {
          bracket--;
          if (bracket < 0) {
            return {
              reason: `多了一个 ']'（位置 ${i + 1}），无对应的 '['`,
            };
          }
        }
        continue;
      }
      case 'single-quote':
      case 'double-quote': {
        if (c === '\\') {
          i++;
          continue;
        }
        if (state === 'single-quote' && c === "'") {
          state = 'normal';
        } else if (state === 'double-quote' && c === '"') {
          state = 'normal';
        }
        continue;
      }
      case 'template': {
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === '`') {
          state = 'normal';
          continue;
        }
        if (c === '$' && next === '{') {
          brace++;
          templateBraceStack.push(brace);
          state = 'normal';
          i++;
        }
        continue;
      }
      case 'line-comment': {
        if (c === '\n') {
          state = 'normal';
        }
        continue;
      }
      case 'block-comment': {
        if (c === '*' && next === '/') {
          state = 'normal';
          i++;
        }
        continue;
      }
    }
  }

  if (state === 'single-quote' || state === 'double-quote') {
    return {reason: '字符串字面量未闭合（缺少匹配的引号）'};
  }
  if (state === 'template') {
    return {reason: '模板字符串未闭合（缺少匹配的反引号）'};
  }
  if (state === 'block-comment') {
    return {reason: '块注释未闭合（缺少 */）'};
  }
  if (templateBraceStack.length > 0) {
    return {reason: '模板字符串中的 ${...} 未闭合'};
  }
  if (paren !== 0) {
    return {
      reason:
        paren > 0
          ? `function 定义不完整：缺少 ${paren} 个 ')'`
          : `function 定义不完整：多了 ${-paren} 个 ')'`,
    };
  }
  if (brace !== 0) {
    return {
      reason:
        brace > 0
          ? `function 定义不完整：缺少 ${brace} 个 '}'`
          : `function 定义不完整：多了 ${-brace} 个 '}'`,
    };
  }
  if (bracket !== 0) {
    return {
      reason:
        bracket > 0
          ? `function 定义不完整：缺少 ${bracket} 个 ']'`
          : `function 定义不完整：多了 ${-bracket} 个 ']'`,
    };
  }

  return null;
}
