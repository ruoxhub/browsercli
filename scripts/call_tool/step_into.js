#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'step_into',
  description: '单步进入',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
