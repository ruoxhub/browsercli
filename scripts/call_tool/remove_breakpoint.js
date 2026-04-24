#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'remove_breakpoint',
  description: '移除断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
