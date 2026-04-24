#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'delete_session_state',
  description: '删除会话状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
