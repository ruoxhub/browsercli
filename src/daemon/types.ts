/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon message format from CLI to daemon
 */
export interface DaemonMessage {
  method: 'invoke_tool' | 'invoke_skill' | 'stop' | 'status';
  tool?: string;
  skill?: string;
  args?: Record<string, unknown>;
}

/**
 * Daemon response format from daemon to CLI
 */
export interface DaemonResponse {
  success: boolean;
  result?: string;
  error?: string;
  message?: string;
}
