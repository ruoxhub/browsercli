#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_websocket_message',
  description: '获取 WebSocket 消息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
