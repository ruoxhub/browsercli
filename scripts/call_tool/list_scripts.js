#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_scripts',
  description: '列出脚本',
  callMode: 'runtime',
  schema: {
    filter: 'string',
  },
  defaultParams: {
    filter: 'keyword',
  },
});
