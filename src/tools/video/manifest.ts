/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'video',
  description: 'Browser session video recording and management.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './video/video.js',
      handlerName: 'video',
    },
  ],
} satisfies DomainManifest;
