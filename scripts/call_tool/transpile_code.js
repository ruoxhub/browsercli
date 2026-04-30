#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'transpile_code',
  description: '转译代码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
