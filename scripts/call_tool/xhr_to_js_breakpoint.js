#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'xhr_to_js_breakpoint',
  description: 'XHR 到 JS 断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
