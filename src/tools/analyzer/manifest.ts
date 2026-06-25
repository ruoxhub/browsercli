/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'analyzer',
  description: 'Static and AI-assisted JavaScript analysis tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './analyzer/deobfuscate.js', handlerName: 'deobfuscateCode'},
    {modulePath: './analyzer/understand.js', handlerName: 'understandCode'},
    {modulePath: './analyzer/summarize.js', handlerName: 'summarizeCode'},
    {modulePath: './analyzer/detectCrypto.js', handlerName: 'detectCrypto'},
    {modulePath: './analyzer/reports.js', handlerName: 'record_reverse_evidence'},
    {modulePath: './analyzer/analyzeTarget.js', handlerName: 'analyze_target'},
    {modulePath: './analyzer/riskPanel.js', handlerName: 'riskPanel'},
    {modulePath: './analyzer/reports.js', handlerName: 'export_session_report'},
  ],
} satisfies DomainManifest;
