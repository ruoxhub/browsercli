/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'screenshot',
  description: 'Screenshot tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './screenshot/takeScreenshot.js',
      handlerName: 'takeScreenshot',
    },
  ],
} satisfies DomainManifest;
