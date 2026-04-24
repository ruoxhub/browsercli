#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'scroll_by',
  description: '滚动页面',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
