#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_hook_data',
  description: '获取 Hook 数据',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
