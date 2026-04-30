#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'deobfuscate_code',
  description: '去混淆代码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {
    code: `function _0x5c1a(){const _0x2f8b=['log','Hello, JSReverser-MCP!'];_0x5c1a=function(){return _0x2f8b;};return _0x5c1a();}function _0x1f4d(_0x31f4f6,_0x4df9ff){const _0x5c1af4=_0x5c1a();return _0x1f4d=function(_0x1f4d7d,_0x2dcf8d){_0x1f4d7d=_0x1f4d7d-0x0;return _0x5c1af4[_0x1f4d7d];},_0x1f4d(_0x31f4f6,_0x4df9ff);}console[_0x1f4d(0x0)](_0x1f4d(0x1));`,
    aggressive: true,
    renameVariables: true,
  },
});
