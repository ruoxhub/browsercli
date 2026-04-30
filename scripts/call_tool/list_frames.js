#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_frames',
  description: '列出框架',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
