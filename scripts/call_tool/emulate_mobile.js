#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'emulate_mobile',
  description: '模拟移动设备',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
