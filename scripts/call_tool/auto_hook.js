#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'auto_hook',
  description: '自动 Hook：按预设生成调试 Hook 和加密库 Hook 注入计划',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
