#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_console_messages',
  description: '列出控制台消息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
