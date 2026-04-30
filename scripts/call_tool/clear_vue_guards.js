#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'clear_vue_guards',
  description: '清除 Vue 守卫',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
