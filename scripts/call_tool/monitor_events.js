#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'monitor_events',
  description: '监控事件',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
