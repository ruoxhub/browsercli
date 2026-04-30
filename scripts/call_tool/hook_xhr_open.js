#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_xhr_open',
  description: 'Hook XHR Open',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
