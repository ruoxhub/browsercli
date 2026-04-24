#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_function',
  description: 'Hook 函数',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
