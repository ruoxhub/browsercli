/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'stealth',
  description: 'Browser stealth and fingerprint tools.',
  profile: 'full',
  tools: [
    {modulePath: './stealth/stealth.js', handlerName: 'setUserAgent'},
    {modulePath: './stealth/stealth.js', handlerName: 'injectStealth'},
    {modulePath: './stealth/stealth.js', handlerName: 'listStealthFeatures'},
    {modulePath: './stealth/stealth.js', handlerName: 'listStealthPresets'},
  ],
} satisfies DomainManifest;
