#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'diff_code',
  description: '差异代码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
