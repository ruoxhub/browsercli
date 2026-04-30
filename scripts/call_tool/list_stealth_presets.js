#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_stealth_presets',
  description: '列出隐身预设',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
