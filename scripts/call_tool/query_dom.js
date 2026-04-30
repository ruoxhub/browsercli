#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'query_dom',
  description: '查询 DOM',
  callMode: 'frame',
  schema: {
    selector: 'string',
    all: 'boolean',
    limit: 'number',
  },
  defaultParams: {
    selector: '#app',
    all: false,
    limit: 10,
  },
});
