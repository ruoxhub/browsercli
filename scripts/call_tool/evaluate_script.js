#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'evaluate_script',
  description: '执行脚本',
  callMode: 'runtime',
  schema: {
    function: 'string',
  },
  defaultParams: {
    function: '() => document.title',
  },
});
