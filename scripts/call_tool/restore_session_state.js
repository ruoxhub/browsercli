#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'restore_session_state',
  description: '恢复会话状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
