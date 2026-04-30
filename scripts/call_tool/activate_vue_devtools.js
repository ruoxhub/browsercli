#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'activate_vue_devtools',
  description: '激活 Vue Devtools',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
