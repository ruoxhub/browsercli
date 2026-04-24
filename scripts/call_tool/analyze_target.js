#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'analyze_target',
  description: '分析目标',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
