#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'check_browser_health',
  description: '检查浏览器健康状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
