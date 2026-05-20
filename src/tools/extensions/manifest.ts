/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'extensions',
  description: 'Browser extension management tools.',
  tools: [
    {modulePath: './extensions/updateExtensions.js', handlerName: 'updateExtensions'},
  ],
} satisfies DomainManifest;
