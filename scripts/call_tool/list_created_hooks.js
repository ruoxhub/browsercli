#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_created_hooks',
  description: '列出已创建 Hook',
  callMode: 'frame',
  schema: {
    hookId: 'string?',
    verbose: 'boolean?',
    type: 'string?',
    event: 'string?',
    phase: 'string?',
  },
  defaultParams: {verbose: true},
});
