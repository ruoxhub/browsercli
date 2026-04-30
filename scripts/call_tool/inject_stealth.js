#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'inject_stealth',
  description: '注入隐身',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
