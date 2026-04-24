#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'stop_monitor',
  description: '停止监控',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
