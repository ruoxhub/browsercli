#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'search_in_scripts',
  description: '搜索脚本',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
