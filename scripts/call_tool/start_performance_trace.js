#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'start_performance_trace',
  description: '开始性能追踪',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
