#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'understand_code',
  description: '理解代码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
