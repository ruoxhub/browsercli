#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'save_session_state',
  description: '保存会话状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
