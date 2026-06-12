/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import type {DebuggerContext} from '../../DebuggerContext.js';
import {getErrorMessage} from '../shared/pageResponse.js';

export type DebuggerRuntime = {
  getDebuggerContext(): Promise<DebuggerContext>;
};

export async function getDebuggerFromContext(
  runtime: unknown,
): Promise<DebuggerContext> {
  if (
    !runtime ||
    typeof (runtime as DebuggerRuntime).getDebuggerContext !== 'function'
  ) {
    throw new Error(
      '缺少调试运行时上下文。请确保：1) 已选中页面；2) 工具通过 defineTool 上下文调用（ToolAdapter）。',
    );
  }
  try {
    return await (runtime as DebuggerRuntime).getDebuggerContext();
  } catch (err) {
    throw new Error(`获取调试上下文失败: ${getErrorMessage(err)}`);
  }
}

export async function runTool<P = unknown>(
  response: {setStructuredContent(content: unknown): void},
  request: {params: P},
  tooltype: string,
  run: () => Promise<void>,
  options: {
    errorData?: (params: P) => Record<string, unknown>;
    errorPrefix?: string;
  } = {},
): Promise<void> {
  const {errorData = () => ({}), errorPrefix} = options;
  try {
    await run();
  } catch (error) {
    const raw = getErrorMessage(error);
    const message = errorPrefix ? `${errorPrefix}: ${raw}` : raw;
    response.setStructuredContent({
      success: false,
      message,
      tooltype,
      data: errorData(request.params),
    });
  }
}
