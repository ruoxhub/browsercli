/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'proxy',
  description: 'Non-browser MITM traffic capture tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './proxy/startMitmProxy.js',
      handlerName: 'startMitmProxy',
    },
    {
      modulePath: './proxy/stopMitmProxy.js',
      handlerName: 'stopMitmProxy',
    },
    {
      modulePath: './proxy/listMitmRequests.js',
      handlerName: 'listMitmRequests',
    },
    {
      modulePath: './proxy/getMitmRequest.js',
      handlerName: 'getMitmRequest',
    },
    {
      modulePath: './proxy/clearMitmRequests.js',
      handlerName: 'clearMitmRequests',
    },
    {
      modulePath: './proxy/exportMitmCa.js',
      handlerName: 'exportMitmCa',
    },
  ],
} satisfies DomainManifest;
