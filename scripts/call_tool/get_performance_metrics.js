#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_performance_metrics',
  description: '获取性能指标',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
