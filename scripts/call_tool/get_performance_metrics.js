#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_performance_metrics',
  description: '获取性能指标',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
