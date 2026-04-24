#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'analyze_websocket_messages',
  description: '分析 WebSocket 消息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
