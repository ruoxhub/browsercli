/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'data',
  description: 'Structured data extraction tools.',
  profile: 'full',
  tools: [{modulePath: './data/extractTable.js', handlerName: 'extractTable'}],
} satisfies DomainManifest;
