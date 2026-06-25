/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'dialog',
  description: 'Browser dialog handling tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './dialog/handleDialog.js', handlerName: 'handleDialog'},
  ],
} satisfies DomainManifest;
