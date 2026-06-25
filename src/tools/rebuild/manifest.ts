/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'rebuild',
  description: 'Bundle rebuilding and environment diff tools.',
  profile: 'full',
  tools: [
    {modulePath: './rebuild/index.js', handlerName: 'exportRebuildBundle'},
    {modulePath: './rebuild/index.js', handlerName: 'diffEnvRequirements'},
  ],
} satisfies DomainManifest;
