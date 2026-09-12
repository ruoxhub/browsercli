/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'analyzer',
  description: 'Reverse-engineering evidence and session report tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './analyzer/reports.js',
      handlerName: 'record_reverse_evidence',
    },
    {modulePath: './analyzer/reports.js', handlerName: 'export_session_report'},
  ],
} satisfies DomainManifest;
