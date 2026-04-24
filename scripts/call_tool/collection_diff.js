#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'collection_diff',
  description: '收集差异',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
