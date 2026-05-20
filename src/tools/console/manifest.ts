/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'console',
  description: 'Browser console inspection tools.',
  tools: [
    {modulePath: './console/listConsoleMessages.js', handlerName: 'listConsoleMessages'},
    {modulePath: './console/getConsoleMessage.js', handlerName: 'getConsoleMessage'},
  ],
} satisfies DomainManifest;
