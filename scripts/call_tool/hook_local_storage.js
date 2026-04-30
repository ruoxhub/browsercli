#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_local_storage',
  description: 'Hook Local Storage',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
