#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'select_page',
  description: '选择页面',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
