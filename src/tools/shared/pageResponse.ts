/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Response} from '../ToolDefinition.js';

export function sendJson(response: Response, payload: unknown): void {
  response.setStructuredContent(payload);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
