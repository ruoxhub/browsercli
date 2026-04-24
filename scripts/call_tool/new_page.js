#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'new_page',
  description: '新建页面并导航到指定URL',
  callMode: 'runtime',
  schema: {
    url: 'string',
    timeout: 'number',
  },
  defaultParams: {
    url: 'https://example.com',
    timeout: 10000,
  },
});
