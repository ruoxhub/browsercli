#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_storage',
  description: '获取存储',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
