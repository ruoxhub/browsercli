#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_websocket_connections',
  description: '列出 WebSocket 连接',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
