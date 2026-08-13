/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ErrorCodes,
  ToolError,
  type ToolErrorCode,
} from '../../utils/errors.js';

export interface CDPErrorContext {
  recoveryHint?: string;
  targetId?: string;
  sessionId?: string;
}

interface CDPErrorPattern {
  pattern: RegExp;
  code: ToolErrorCode;
  legacyName: string;
  message: string;
  recoveryHint?: string;
  recoverable?: boolean;
}

const CDP_ERROR_PATTERNS: CDPErrorPattern[] = [
  {
    pattern: /Session closed/i,
    code: ErrorCodes.CONNECTION,
    legacyName: 'CDP_SESSION_CLOSED',
    message: 'CDP 会话已关闭，页面可能已被关闭',
    recoveryHint: '请重新调用 dump_target_scripts 获取新的临时会话。',
  },
  {
    pattern: /Target closed/i,
    code: ErrorCodes.CONNECTION,
    legacyName: 'CDP_TARGET_CLOSED',
    message: '目标页面已关闭',
    recoveryHint: '请重新调用 list_targets，并使用最新的 targetId 重试。',
  },
  {
    pattern: /No target with given id|Target .* not found/i,
    code: ErrorCodes.NOT_FOUND,
    legacyName: 'CDP_TARGET_NOT_FOUND',
    message: 'Target 已关闭或不存在',
    recoveryHint: '请重新调用 list_targets，并使用最新的 targetId 重试。',
    recoverable: true,
  },
  {
    pattern: /Cannot find context/i,
    code: ErrorCodes.RUNTIME,
    legacyName: 'CDP_CONTEXT_GONE',
    message: '执行上下文已销毁（页面导航或刷新）',
  },
  {
    pattern: /Execution context was destroyed/i,
    code: ErrorCodes.RUNTIME,
    legacyName: 'CDP_CONTEXT_GONE',
    message: '执行上下文已销毁（页面导航或刷新）',
  },
  {
    pattern: /Protocol error.*Timeout/i,
    code: ErrorCodes.TIMEOUT,
    legacyName: 'CDP_TIMEOUT',
    message: 'CDP 协议调用超时',
    recoveryHint: '请缩小操作范围后重试。',
  },
  {
    pattern: /Timed out/i,
    code: ErrorCodes.TIMEOUT,
    legacyName: 'CDP_TIMEOUT',
    message: 'CDP 操作超时',
    recoveryHint: '请缩小操作范围后重试。',
  },
  {
    pattern: /net::ERR_/i,
    code: ErrorCodes.CONNECTION,
    legacyName: 'CDP_NETWORK_ERROR',
    message: '网络请求失败',
  },
  {
    pattern: /Connection closed/i,
    code: ErrorCodes.CONNECTION,
    legacyName: 'CDP_CONNECTION_CLOSED',
    message: '与浏览器的连接已断开',
    recoveryHint: '请重新连接浏览器后重试。',
  },
  {
    pattern: /WebSocket is not open/i,
    code: ErrorCodes.CONNECTION,
    legacyName: 'CDP_CONNECTION_CLOSED',
    message: 'WebSocket 连接已关闭',
    recoveryHint: '请重新连接浏览器后重试。',
  },
  {
    pattern: /Frame was detached/i,
    code: ErrorCodes.RUNTIME,
    legacyName: 'CDP_FRAME_DETACHED',
    message: 'Frame 已分离（页面导航中）',
  },
];

export function mapCDPError(
  error: unknown,
  context: CDPErrorContext = {},
): Error {
  const msg = error instanceof Error ? error.message : String(error);
  const match = CDP_ERROR_PATTERNS.find(p => p.pattern.test(msg));
  if (match) {
    const recoveryHint = context.recoveryHint ?? match.recoveryHint;
    const mapped = new ToolError(
      match.code,
      `${match.message}${recoveryHint ? `；${recoveryHint}` : ''} (原始: ${msg})`,
      {
        originalMessage: msg,
        ...context,
        recoveryHint,
      },
      match.recoverable,
    );
    mapped.name = match.legacyName;
    if (error instanceof Error) {
      mapped.stack = error.stack;
    }
    return mapped;
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export function isCDPSessionGone(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Session closed|Target closed|Connection closed|WebSocket is not open/i.test(
    msg,
  );
}

export async function wrapCDPCall<T>(
  fn: () => Promise<T>,
  context: CDPErrorContext = {},
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapCDPError(error, context);
  }
}
