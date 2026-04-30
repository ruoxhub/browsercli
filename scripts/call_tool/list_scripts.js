#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_scripts',
  description: '列出脚本',
  callMode: 'runtime',
  schema: {
    filter: 'string',
  },
  defaultParams: {
    filter: 'keyword',
  },
});
