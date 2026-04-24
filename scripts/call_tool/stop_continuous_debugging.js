#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'stop_continuous_debugging',
  description: '停止连续调试',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
