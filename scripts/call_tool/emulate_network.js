#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'emulate_network',
  description: '模拟网络',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
