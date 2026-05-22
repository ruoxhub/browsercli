/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'pipeline',
  description: 'Analysis pipeline example tools.',
  profile: 'full',
  tools: [
    {modulePath: './pipeline/examples.js', handlerName: 'analyzePipeline'},
  ],
} satisfies DomainManifest;
