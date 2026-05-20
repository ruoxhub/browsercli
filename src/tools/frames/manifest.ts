/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'frames',
  description: 'Frame listing and selection tools.',
  tools: [
    {modulePath: './frames/listFrames.js', handlerName: 'listFrames'},
    {modulePath: './frames/selectFrame.js', handlerName: 'selectFrame'},
  ],
} satisfies DomainManifest;
