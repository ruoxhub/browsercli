#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'step_out',
  description: '单步跳出',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
