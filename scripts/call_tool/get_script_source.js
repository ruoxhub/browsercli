#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_script_source',
  description: '获取脚本源码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
