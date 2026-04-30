#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'find_clickable_elements',
  description: '查找可点击元素',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
