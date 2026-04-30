#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'click_at',
  description: '在坐标点击',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
