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
    {
      modulePath: './proxy/addRewriteRule.js',
      handlerName: 'addRewriteRule',
    },
    {
      modulePath: './proxy/listMitmRules.js',
      handlerName: 'listMitmRules',
    },
    {
      modulePath: './proxy/removeMitmRule.js',
      handlerName: 'removeMitmRule',
    },
    {
      modulePath: './proxy/clearMitmRules.js',
      handlerName: 'clearMitmRules',
    },
    {
      modulePath: './proxy/exportMitmHar.js',
      handlerName: 'exportMitmHar',
    },
    {
      modulePath: './proxy/addHostFilter.js',
      handlerName: 'addHostFilter',
    },
    {
      modulePath: './proxy/listHostFilters.js',
      handlerName: 'listHostFilters',
    },
    {
      modulePath: './proxy/removeHostFilter.js',
      handlerName: 'removeHostFilter',
    },
    {
      modulePath: './proxy/clearHostFilters.js',
      handlerName: 'clearHostFilters',
    },
  ],
} satisfies DomainManifest;
