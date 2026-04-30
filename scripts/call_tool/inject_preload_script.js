#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'inject_preload_script',
  description: '注入预加载脚本',
  callMode: 'runtime',
  schema: {
    script: 'string',
  },
  defaultParams: {
    script: '() => document.title',
  },
});
