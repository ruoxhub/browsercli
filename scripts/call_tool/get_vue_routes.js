#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_vue_routes',
  description: '获取 Vue 路由',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
