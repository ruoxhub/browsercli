#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_hook_data',
  description: '获取 Hook 数据',
  callMode: 'frame',
  schema: {
    hookId: 'string?',
    view: 'string?',
    maxRecords: 'number?',
    type: 'string?',
    event: 'string?',
    phase: 'string?',
  },
  defaultParams: {hookId: 'hook_id_here', view: 'detail', maxRecords: 20},
});
