/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'console',
  description: 'Browser console inspection tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './console/listConsoleMessages.js', handlerName: 'listConsoleMessages'},
    {modulePath: './console/getConsoleMessage.js', handlerName: 'getConsoleMessage'},
  ],
} satisfies DomainManifest;
