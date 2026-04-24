#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_script_source',
  description: '获取脚本源码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
