#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'trace_function',
  description: '追踪函数',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
