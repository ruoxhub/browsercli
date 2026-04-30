#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'set_breakpoint_on_text',
  description: '在文本上设置断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
