#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_breakpoints',
  description: '列出断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
