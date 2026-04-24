#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_code_template',
  description: '获取代码模板',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
