/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'anti-debug',
  description: 'Anti-debugging detection and bypass tools.',
  tools: [
    {modulePath: './anti-debug/antiAntiDebug.js', handlerName: 'antiAntiDebug'},
    {modulePath: './anti-debug/bypassDebugger.js', handlerName: 'bypassDebugger'},
  ],
} satisfies DomainManifest;
