/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'session',
  description: 'Unified capture session management and data query tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './session/session_create.js',
      handlerName: 'sessionCreate',
    },
    {
      modulePath: './session/session_list.js',
      handlerName: 'sessionList',
    },
  ],
} satisfies DomainManifest;
