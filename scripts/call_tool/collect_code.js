#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'collect_code',
  description: '收集代码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
