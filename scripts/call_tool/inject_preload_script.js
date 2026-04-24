#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'inject_preload_script',
  description: '注入预加载脚本',
  callMode: 'runtime',
  schema: {
    script: 'string',
  },
  defaultParams: {
    script: '() => document.title',
  },
});
