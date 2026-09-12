/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'jsvmp',
  description: 'JSVMP runtime probes and browser environment comparison.',
  profile: 'workflow',
  prerequisites: {
    hookJsvmpInterpreter: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
    compareEnv: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
  },
  sceneKeywords: {
    hookJsvmpInterpreter: [
      'jsvmp',
      'virtual machine',
      'runtime probe',
      'environment access',
    ],
    compareEnv: ['environment', 'fingerprint', 'navigator', 'jsdom'],
  },
  tools: [
    {modulePath: './jsvmp/jsvmp.js', handlerName: 'hookJsvmpInterpreter'},
    {modulePath: './jsvmp/jsvmp.js', handlerName: 'compareEnv'},
  ],
} satisfies DomainManifest;
