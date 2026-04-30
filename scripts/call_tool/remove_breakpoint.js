#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'remove_breakpoint',
  description: '移除断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
