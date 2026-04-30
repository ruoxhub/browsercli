#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'select_page',
  description: '选择页面',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
