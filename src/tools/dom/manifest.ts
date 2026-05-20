/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'dom',
  description: 'DOM inspection and querying tools.',
  tools: [
    {modulePath: './dom/queryDom.js', handlerName: 'queryDom'},
    {modulePath: './dom/getDomStructure.js', handlerName: 'getDomStructure'},
    {modulePath: './dom/findClickableElements.js', handlerName: 'findClickableElements'},
  ],
} satisfies DomainManifest;
