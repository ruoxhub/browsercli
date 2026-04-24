#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'start_continuous_debugging',
  description: '开始连续调试',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
