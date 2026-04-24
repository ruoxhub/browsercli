#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'pause',
  description: '暂停执行',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
