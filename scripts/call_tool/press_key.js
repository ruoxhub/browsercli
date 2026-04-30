#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'press_key',
  description: '按键',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
