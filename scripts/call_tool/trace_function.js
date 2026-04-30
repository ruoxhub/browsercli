#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'trace_function',
  description: '追踪函数',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
