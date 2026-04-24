#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'resume',
  description: '继续执行',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
