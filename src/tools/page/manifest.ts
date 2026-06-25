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
    {modulePath: './page/clickElement.js', handlerName: 'clickElement'},
    {modulePath: './page/typeText.js', handlerName: 'typeText'},
    {modulePath: './page/waitForElement.js', handlerName: 'waitForElement'},
    {modulePath: './page/scrollBy.js', handlerName: 'scrollBy'},
    {modulePath: './page/sessionState.js', handlerName: 'saveSessionState'},
    {modulePath: './page/sessionState.js', handlerName: 'restoreSessionState'},
    {modulePath: './page/sessionState.js', handlerName: 'listSessionStates'},
    {modulePath: './page/sessionState.js', handlerName: 'deleteSessionState'},
    {modulePath: './page/sessionState.js', handlerName: 'dumpSessionState'},
    {modulePath: './page/sessionState.js', handlerName: 'loadSessionState'},
    {
      modulePath: './page/checkBrowserHealth.js',
      handlerName: 'checkBrowserHealth',
    },
  ],
} satisfies DomainManifest;
