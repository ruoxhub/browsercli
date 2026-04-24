#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'search_in_scripts',
  description: '搜索脚本',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
