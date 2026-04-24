#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_console_message',
  description: '获取控制台消息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
