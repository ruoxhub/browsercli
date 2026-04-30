#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_code_template',
  description: '获取代码模板',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
