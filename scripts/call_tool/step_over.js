#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'step_over',
  description: '单步跳过',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
