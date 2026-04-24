#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'update_extensions',
  description: '更新扩展',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
