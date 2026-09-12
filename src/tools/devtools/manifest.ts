/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'devtools',
  description: 'DevTools window collaboration tools.',
  profile: 'full',
  tools: [
    {modulePath: './devtools/openDevtools.js', handlerName: 'openDevtools'},
    {
      modulePath: './devtools/getDevtoolsComments.js',
      handlerName: 'getDevtoolsComments',
    },
    {
      modulePath: './devtools/resolveDevtoolsComment.js',
      handlerName: 'resolveDevtoolsComment',
    },
    {
      modulePath: './devtools/revealInDevtools.js',
      handlerName: 'revealInDevtools',
    },
  ],
} satisfies DomainManifest;
