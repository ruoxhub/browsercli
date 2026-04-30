#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'set_user_agent',
  description: '设置 User-Agent',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
