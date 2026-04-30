#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_console_log',
  description: 'Hook Console Log',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
