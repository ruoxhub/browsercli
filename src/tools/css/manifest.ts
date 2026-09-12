/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'css',
  description: 'CSS cascade inspection tools.',
  profile: 'workflow',
  tools: [{modulePath: './css/getCssStyles.js', handlerName: 'getCssStyles'}],
} satisfies DomainManifest;
