#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'break_on_xhr',
  description: 'XHR 断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
