#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'start_continuous_debugging',
  description: '开始连续调试',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
