#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'stop_performance_trace',
  description: '停止性能追踪',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
