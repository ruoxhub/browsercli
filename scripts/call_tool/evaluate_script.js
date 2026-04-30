#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'evaluate_script',
  description: '执行脚本',
  callMode: 'runtime',
  schema: {
    function: 'string',
  },
  defaultParams: {
    function: '() => document.title',
  },
});
