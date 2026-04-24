#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_websocket',
  description: 'Hook WebSocket',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
