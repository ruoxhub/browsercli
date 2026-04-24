#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'performance_analyze_insight',
  description: '分析性能洞察',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
