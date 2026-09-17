/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'extensions',
  description: 'Browser extension management and connection tools.',
  profile: 'full',
  tools: [
    {
      modulePath: './extensions/updateExtensions.js',
      handlerName: 'updateExtensions',
    },
    {
      modulePath: './extensions/extensionTools.js',
      handlerName: 'extensionStatus',
    },
    {
      modulePath: './extensions/extensionTools.js',
      handlerName: 'extensionListTabs',
    },
    {
      modulePath: './extensions/extensionTools.js',
      handlerName: 'extensionClaimTab',
    },
    {
      modulePath: './extensions/extensionTools.js',
      handlerName: 'extensionCreateTab',
    },
    {
      modulePath: './extensions/extensionTools.js',
      handlerName: 'extensionExecuteCdp',
    },
    {
      modulePath: './extensions/extensionTools.js',
      handlerName: 'extensionMoveMouse',
    },
  ],
} satisfies DomainManifest;
