/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'wasm',
  description: 'WebAssembly reverse engineering tools.',
  profile: 'full',
  tools: [
    {modulePath: './wasm/index.js', handlerName: 'collectWasm'},
    {modulePath: './wasm/index.js', handlerName: 'wasmDump'},
    {modulePath: './wasm/index.js', handlerName: 'wasmVmpTrace'},
    {modulePath: './wasm/index.js', handlerName: 'wasmMemoryInspect'},
  ],
} satisfies DomainManifest;
