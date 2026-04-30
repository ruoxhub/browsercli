#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'dump_session_state',
  description: '导出会话状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
