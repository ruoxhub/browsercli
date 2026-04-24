#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'emulate_cpu',
  description: '模拟 CPU',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
