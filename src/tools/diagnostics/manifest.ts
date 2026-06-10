/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'diagnostics',
  description: 'Environment diagnostics and health checks.',
  profile: 'search',
  tools: [
    {
      modulePath: './diagnostics/diagnoseEnvironment.js',
      handlerName: 'diagnoseEnvironmentTool',
    },
  ],
} satisfies DomainManifest;
