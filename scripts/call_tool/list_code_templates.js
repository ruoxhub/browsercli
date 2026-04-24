#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_code_templates',
  description: '列出代码模板',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
