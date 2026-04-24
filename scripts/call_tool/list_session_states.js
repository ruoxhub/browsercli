#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_session_states',
  description: '列出会话状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
