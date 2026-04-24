#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'dump_session_state',
  description: '导出会话状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
