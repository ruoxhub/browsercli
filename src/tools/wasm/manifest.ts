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
    {modulePath: './wasm/index.js', handlerName: 'wasmCapabilities'},
    {modulePath: './wasm/index.js', handlerName: 'collectWasm'},
    {modulePath: './wasm/index.js', handlerName: 'wasmDump'},
    {modulePath: './wasm/index.js', handlerName: 'wasmDisassemble'},
    {modulePath: './wasm/index.js', handlerName: 'wasmDecompile'},
    {modulePath: './wasm/index.js', handlerName: 'wasmInspectSections'},
    {modulePath: './wasm/index.js', handlerName: 'wasmOfflineRun'},
    {modulePath: './wasm/index.js', handlerName: 'wasmOptimize'},
    {modulePath: './wasm/index.js', handlerName: 'wasmVmpTrace'},
    {modulePath: './wasm/index.js', handlerName: 'wasmMemoryInspect'},
  ],
} satisfies DomainManifest;
