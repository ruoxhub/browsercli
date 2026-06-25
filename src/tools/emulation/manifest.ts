/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'emulation',
  description: 'Device, CPU, network, and viewport emulation tools.',
  profile: 'full',
  tools: [
    {modulePath: './emulation/emulateMobile.js', handlerName: 'emulateMobile'},
    {modulePath: './emulation/emulateNetwork.js', handlerName: 'emulateNetwork'},
    {modulePath: './emulation/emulateCpu.js', handlerName: 'emulateCpu'},
    {modulePath: './emulation/resizePage.js', handlerName: 'resizePage'},
  ],
} satisfies DomainManifest;
