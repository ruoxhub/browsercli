/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'navigation',
  description: 'Browser page navigation tools.',
  tools: [
    {modulePath: './navigation/listPages.js', handlerName: 'listPages'},
    {modulePath: './navigation/selectPage.js', handlerName: 'selectPage'},
    {modulePath: './navigation/newPage.js', handlerName: 'newPage'},
    {modulePath: './navigation/navigatePage.js', handlerName: 'navigatePage'},
  ],
} satisfies DomainManifest;
