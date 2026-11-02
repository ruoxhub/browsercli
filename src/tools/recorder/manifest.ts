/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'recorder',
  description: 'User interaction and operation evidence recording tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './recorder/recordTools.js',
      handlerName: 'recordStart',
    },
    {
      modulePath: './recorder/recordTools.js',
      handlerName: 'recordStop',
    },
  ],
} satisfies DomainManifest;
