#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'stop_monitor',
  description: '停止监控',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
