#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_pages',
  description: '列出页面',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
