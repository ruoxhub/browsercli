/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MonitorRecord {
  target: EventTarget;
  listeners: Record<string, EventListener>;
}

export interface MonitorWindow extends Window {
  __mcp_monitors__?: Record<string, MonitorRecord>;
}
