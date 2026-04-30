#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'search_in_sources',
  description: '搜索源码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
