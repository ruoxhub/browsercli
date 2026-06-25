/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'extensions',
  description: 'Browser extension management tools.',
  profile: 'full',
  tools: [
    {modulePath: './extensions/updateExtensions.js', handlerName: 'updateExtensions'},
  ],
} satisfies DomainManifest;
