#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'set_breakpoint',
  description: '设置断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
