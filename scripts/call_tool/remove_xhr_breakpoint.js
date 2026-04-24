#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'remove_xhr_breakpoint',
  description: '移除 XHR 断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
