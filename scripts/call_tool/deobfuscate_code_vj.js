#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'deobfuscate_code_vj',
  description: '去混淆代码 (v_jstools)',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
