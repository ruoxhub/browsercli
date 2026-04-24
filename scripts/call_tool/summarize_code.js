#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'summarize_code',
  description: '总结代码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
