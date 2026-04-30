#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'click_element',
  description: '点击元素',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
