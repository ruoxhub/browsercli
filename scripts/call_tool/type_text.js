#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'type_text',
  description: '输入文本',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
