#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'unhook_function',
  description: '取消 Hook 函数',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
