/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'diagnostics',
  description: 'Environment diagnostics and health checks.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './diagnostics/diagnoseEnvironment.js',
      handlerName: 'diagnoseEnvironmentTool',
    },
  ],
} satisfies DomainManifest;
