/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'vjstools',
  description: 'VJSTools code transformation tools.',
  tools: [
    {modulePath: './vjstools/deobfuscate.js', handlerName: 'deobfuscateCodeVj'},
    {modulePath: './vjstools/deobfuscate.js', handlerName: 'minifyCode'},
    {modulePath: './vjstools/deobfuscate.js', handlerName: 'transpileCodeTool'},
    {modulePath: './vjstools/deobfuscate.js', handlerName: 'analyzeAstTool'},
    {modulePath: './vjstools/deobfuscate.js', handlerName: 'diffCodeTool'},
  ],
} satisfies DomainManifest;
