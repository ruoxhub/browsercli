#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'set_breakpoint',
  description: '设置断点',
  callMode: 'runtime',
  schema: {
    url: 'string',
    lineNumber: 'number',
    columnNumber: 'number',
    condition: 'string',
    isRegex: 'boolean',
  },
  defaultParams: {
    url: 'app.js',
    lineNumber: 10,
    columnNumber: 0,
    condition: '',
    isRegex: false,
  },
});
