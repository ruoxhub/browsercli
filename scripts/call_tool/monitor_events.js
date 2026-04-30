#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'monitor_events',
  description: '监控事件',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
