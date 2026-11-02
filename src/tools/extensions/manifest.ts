/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'extensions',
  description: 'Chrome extension management tools.',
  profile: 'full',
  tools: [
    {modulePath: './extensions/extensions.js', handlerName: 'listExtensions'},
    {modulePath: './extensions/extensions.js', handlerName: 'installExtension'},
    {modulePath: './extensions/extensions.js', handlerName: 'reloadExtension'},
    {
      modulePath: './extensions/extensions.js',
      handlerName: 'triggerExtensionAction',
    },
    {
      modulePath: './extensions/extensions.js',
      handlerName: 'uninstallExtension',
    },
  ],
} satisfies DomainManifest;
