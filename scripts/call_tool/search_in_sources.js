#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'search_in_sources',
  description: '搜索源码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
