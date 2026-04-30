#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'handle_dialog',
  description: '处理对话框',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
