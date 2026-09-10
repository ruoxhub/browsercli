/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createToolError,
  ErrorCodes,
  ToolError,
  type ToolErrorCode,
} from '../../utils/errors.js';

export type ElementFailureKind = 'transient' | 'permanent';

export interface ClassifiedElementError {
  kind: ElementFailureKind;
  code: ToolErrorCode;
  message: string;
  suggestion?: string;
  candidatesCount?: number;
}

/**
 * 分类 Playwright / Patchright 抛出的元素定位与动作错误。
 *
 * ⚠️ 重要设计契约（方向与直觉可能相反）：
 * 1. 0 匹配 / 超时 (TimeoutError) → `transient`（可重试）。
 *    页面元素渲染是异步的，DOM 此时未就绪不代表选择器有误，可自动重试或等待。
 * 2. 多匹配 (strict mode violation) → `permanent`（不可重试，ELEMENT_LOCATOR_AMBIGUOUS）。
 *    在不改变选择器或不加 `>> nth=N` 的情况下重复尝试必定再次命中相同歧义，必须立即报错迫使调用方修正选择器。
 * 3. 语法解析失败 → `permanent`（不可重试，VALIDATION）。
 * 4. 兜底错误 → `permanent` (RUNTIME)。
 */
export function classifyElementError(error: unknown): ClassifiedElementError {
  const errorName =
    error instanceof Error
      ? error.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as {name: unknown}).name)
        : '';
  const rawMessage = error instanceof Error ? error.message : String(error);

  // 1. 超时 / 0 匹配：优先比对稳定类名 Error.name === 'TimeoutError'，正则兜底
  if (
    errorName === 'TimeoutError' ||
    /Timeout \d+ms exceeded/i.test(rawMessage)
  ) {
    return {
      kind: 'transient',
      code: ErrorCodes.TIMEOUT,
      message: rawMessage,
      suggestion: '元素可能尚未渲染；可重试或先 wait_for_element',
    };
  }

  // 2. Strict 模式歧义（多匹配）
  const strictMatch = rawMessage.match(/resolved to (\d+) elements/i);
  if (/strict mode violation/i.test(rawMessage) || strictMatch) {
    const candidatesCount = strictMatch
      ? parseInt(strictMatch[1], 10)
      : undefined;
    return {
      kind: 'permanent',
      code: ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS,
      message: rawMessage,
      suggestion: '用 >> nth=N 消歧或收紧定位器条件',
      candidatesCount,
    };
  }

  // 3. 选择器语法错误（注意：不宽泛匹配 "is not a"，避免误判 Node is not an HTMLInputElement）
  if (
    /while parsing|Unexpected token|is not a valid selector|InvalidSelectorError/i.test(
      rawMessage,
    )
  ) {
    return {
      kind: 'permanent',
      code: ErrorCodes.VALIDATION,
      message: rawMessage,
      suggestion: '定位器语法错误，请检查 CSS/role=/text=/xpath= 语法',
    };
  }

  // 4. 兜底
  return {
    kind: 'permanent',
    code: ErrorCodes.RUNTIME,
    message: rawMessage,
  };
}

/**
 * 将底层元素错误转换为标准统一的 ToolError
 */
export function toElementError(
  error: unknown,
  context: {toolName: string; selector: string; [key: string]: unknown},
): ToolError {
  if (error instanceof ToolError) {
    return error;
  }

  const classification = classifyElementError(error);
  const errorContext: Record<string, unknown> = {
    ...context,
    originalError: classification.message,
  };

  if (classification.suggestion) {
    errorContext.suggestion = classification.suggestion;
  }
  if (classification.candidatesCount !== undefined) {
    errorContext.candidatesCount = classification.candidatesCount;
  }

  return createToolError(
    classification.code,
    classification.message,
    errorContext,
    classification.kind === 'transient',
  );
}
