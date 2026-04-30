#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'emulate_network',
  description: '模拟网络',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
