/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'script',
  description: 'Page script evaluation and preload tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './script/script.js', handlerName: 'evaluateScript'},
    {modulePath: './script/script.js', handlerName: 'injectPreloadScript'},
  ],
} satisfies DomainManifest;
