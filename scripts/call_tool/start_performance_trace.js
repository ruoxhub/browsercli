#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'start_performance_trace',
  description: '开始性能追踪',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
