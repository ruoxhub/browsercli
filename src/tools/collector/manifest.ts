/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'collector',
  description: 'Code and script collection tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './collector/collectCode.js', handlerName: 'collectCode'},
    {modulePath: './collector/collectionDiff.js', handlerName: 'collectionDiff'},
    {modulePath: './collector/searchInScripts.js', handlerName: 'searchInScripts'},
  ],
} satisfies DomainManifest;
