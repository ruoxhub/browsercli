#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_dom_structure',
  description: '获取 DOM 结构',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
