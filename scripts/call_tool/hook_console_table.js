#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_console_table',
  description: 'Hook Console Table',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
