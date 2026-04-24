#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'load_session_state',
  description: '加载会话状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
