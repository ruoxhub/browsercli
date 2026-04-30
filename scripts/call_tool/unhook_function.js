#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'unhook_function',
  description: '取消 Hook 函数',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
