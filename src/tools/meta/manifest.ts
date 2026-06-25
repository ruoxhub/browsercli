/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'meta',
  description: 'Meta tools for tool discovery (search_tools entry point).',
  profile: 'search',
  sceneKeywords: {
    searchTools: ['search', 'discover', 'find tool', 'tool catalog'],
  },
  tools: [
    {modulePath: './meta/searchTools.js', handlerName: 'searchToolsMeta'},
  ],
} satisfies DomainManifest;
