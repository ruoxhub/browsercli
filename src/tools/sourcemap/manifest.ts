/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'sourcemap',
  description:
    'SourceMap discovery, parsing, lookup, reconstruction, and diff tools.',
  profile: 'full',
  tools: [
    {modulePath: './sourcemap/index.js', handlerName: 'sourcemapDiscover'},
    {modulePath: './sourcemap/index.js', handlerName: 'sourcemapParse'},
    {modulePath: './sourcemap/index.js', handlerName: 'sourcemapLookup'},
    {
      modulePath: './sourcemap/index.js',
      handlerName: 'sourcemapReconstructTree',
    },
    {modulePath: './sourcemap/index.js', handlerName: 'sourcemapDiff'},
  ],
} satisfies DomainManifest;
