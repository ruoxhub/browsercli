#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'detect_crypto',
  description: '检测加密',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
