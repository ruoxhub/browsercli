#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'analyze_websocket_messages',
  description: '分析 WebSocket 消息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
