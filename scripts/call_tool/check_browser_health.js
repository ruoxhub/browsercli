#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'check_browser_health',
  description: '检查浏览器健康状态',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
