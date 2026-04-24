#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'navigate_page',
  description: '导航当前页面到URL，或执行前进/后退/刷新',
  callMode: 'runtime',
  schema: {
    type: 'string',
    url: 'string',
    ignoreCache: 'boolean',
    timeout: 'number',
  },
  defaultParams: {
    type: 'navigate',
    url: 'https://example.com',
    ignoreCache: false,
    timeout: 10000,
  },
});
