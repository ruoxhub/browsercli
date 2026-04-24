#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'transpile_code',
  description: '转译代码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
