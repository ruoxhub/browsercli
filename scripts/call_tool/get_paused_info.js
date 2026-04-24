#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_paused_info',
  description: '获取暂停信息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
