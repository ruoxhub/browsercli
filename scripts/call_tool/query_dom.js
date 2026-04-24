#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'query_dom',
  description: '查询 DOM',
  callMode: 'frame',
  schema: {
    selector: 'string',
    all: 'boolean',
    limit: 'number',
  },
  defaultParams: {
    selector: '#app',
    all: false,
    limit: 10,
  },
});
