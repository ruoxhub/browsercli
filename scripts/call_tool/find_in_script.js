#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'find_in_script',
  description: '在脚本中搜索',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
