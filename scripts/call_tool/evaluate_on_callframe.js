#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'evaluate_on_callframe',
  description: '在调用帧上执行',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
