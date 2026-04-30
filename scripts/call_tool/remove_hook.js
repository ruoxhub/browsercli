#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'remove_hook',
  description: '移除 Hook',
  callMode: 'frame',
  schema: {hookId: 'string'},
  defaultParams: {hookId: 'hook_id_here'},
});
