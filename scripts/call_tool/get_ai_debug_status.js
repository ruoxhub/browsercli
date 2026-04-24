#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_ai_debug_status',
  description: '获取 AI 调试状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
