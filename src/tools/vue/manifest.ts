/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'vue',
  description: 'Vue runtime inspection tools.',
  tools: [
    {modulePath: './vue/activateVueDevtools.js', handlerName: 'activateVueDevtools'},
    {modulePath: './vue/clearVueGuards.js', handlerName: 'clearVueGuards'},
    {modulePath: './vue/getVueRoutes.js', handlerName: 'getVueRoutes'},
  ],
} satisfies DomainManifest;
