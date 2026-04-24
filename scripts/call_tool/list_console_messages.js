#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_console_messages',
  description: '列出控制台消息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
