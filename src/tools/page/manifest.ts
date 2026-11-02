/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'page',
  description: 'Page interaction and state tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './page/waitForElement.js', handlerName: 'waitForElement'},
    {modulePath: './page/scrollBy.js', handlerName: 'scrollBy'},
    {
      modulePath: './page/checkBrowserHealth.js',
      handlerName: 'checkBrowserHealth',
      requirements: {
        browser: 'connected',
        recovery: true,
      },
    },
    {modulePath: './page/detectCaptcha.js', handlerName: 'detectCaptcha'},
  ],
} satisfies DomainManifest;
