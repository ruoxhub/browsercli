#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'find_in_script',
  description: '在脚本中搜索',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
