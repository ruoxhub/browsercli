#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'step_out',
  description: '单步跳出',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
