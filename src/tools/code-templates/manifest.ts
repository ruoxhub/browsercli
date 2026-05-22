/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'code-templates',
  description: 'Reusable code template lookup and injection tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './code-templates/getCodeTemplate.js', handlerName: 'getCodeTemplate'},
    {modulePath: './code-templates/injectCodeTemplate.js', handlerName: 'injectCodeTemplate'},
    {modulePath: './code-templates/listCodeTemplates.js', handlerName: 'listCodeTemplates'},
  ],
} satisfies DomainManifest;
