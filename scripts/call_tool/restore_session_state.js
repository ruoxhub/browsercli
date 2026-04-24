#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'restore_session_state',
  description: '恢复会话状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
