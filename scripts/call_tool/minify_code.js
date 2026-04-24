#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'minify_code',
  description: '压缩代码',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
