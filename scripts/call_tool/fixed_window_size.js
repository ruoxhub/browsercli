#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'fixed_window_size',
  description: '固定窗口大小',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
