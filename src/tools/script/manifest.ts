/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'script',
  description: 'Page script evaluation and preload tools.',
  tools: [
    {modulePath: './script/script.js', handlerName: 'evaluateScript'},
    {modulePath: './script/script.js', handlerName: 'injectPreloadScript'},
  ],
} satisfies DomainManifest;
