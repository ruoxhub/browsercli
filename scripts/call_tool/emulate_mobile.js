#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'emulate_mobile',
  description: '模拟移动设备',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
