#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_code_templates',
  description: '列出代码模板',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
