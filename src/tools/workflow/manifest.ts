/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'workflow',
  description: 'High-level reverse engineering workflow tools.',
  tools: [
    {modulePath: './workflow/observeFlow.js', handlerName: 'observeFlow'},
    {modulePath: './workflow/autoHook.js', handlerName: 'autoHook'},
    {modulePath: './workflow/rebuildBundle.js', handlerName: 'rebuildBundle'},
    {modulePath: './workflow/traceSignatureGeneration.js', handlerName: 'traceSignatureGeneration'},
  ],
} satisfies DomainManifest;
