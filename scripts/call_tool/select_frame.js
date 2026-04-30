#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'select_frame',
  description: '选择框架',
  callMode: 'runtime',
  schema: {
    frameIdx: 'number',
  },
  defaultParams: {
    frameIdx: 0,
  },
});
