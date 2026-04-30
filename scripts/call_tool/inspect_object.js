#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'inspect_object',
  description: '检查对象',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
