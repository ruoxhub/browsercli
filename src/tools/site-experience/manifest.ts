/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'site-experience',
  description: 'Site-specific reverse engineering experience tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './site-experience/siteExperience.js', handlerName: 'searchSiteExperience'},
    {modulePath: './site-experience/siteExperience.js', handlerName: 'listSiteExperiences'},
    {modulePath: './site-experience/siteExperience.js', handlerName: 'createSiteExperience'},
    {modulePath: './site-experience/siteExperience.js', handlerName: 'updateSiteExperience'},
    {modulePath: './site-experience/siteExperience.js', handlerName: 'deleteSiteExperience'},
  ],
} satisfies DomainManifest;
