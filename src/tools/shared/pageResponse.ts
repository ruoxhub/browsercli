/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Response} from '../ToolDefinition.js';

export function sendJson(response: Response, payload: unknown): void {
  response.setStructuredContent(payload);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
