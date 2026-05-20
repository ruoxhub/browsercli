/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'crypto',
  description: 'Crypto library hook and inspection tools.',
  tools: [
    {modulePath: './crypto/hookCryptoJS.js', handlerName: 'hookCryptoJS'},
    {modulePath: './crypto/hookJSEncrypt.js', handlerName: 'hookJSEncrypt'},
    {modulePath: './crypto/hookSMCrypto.js', handlerName: 'hookSMCrypto'},
  ],
} satisfies DomainManifest;
