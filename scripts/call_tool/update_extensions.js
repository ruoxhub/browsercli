#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'update_extensions',
  description: '更新扩展',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
