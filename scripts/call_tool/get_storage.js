#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_storage',
  description: '获取存储',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
