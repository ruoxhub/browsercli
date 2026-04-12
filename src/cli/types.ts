/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DaemonContext {
  socketPath: string;
  daemonPid: number | null;
  config: {
    browserUrl?: string;
    wsEndpoint?: string;
    headless?: boolean;
    executablePath?: string;
    http?: boolean;
    port?: string;
  };
}
