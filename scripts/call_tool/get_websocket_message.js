#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_websocket_message',
  description: '获取 WebSocket 消息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
