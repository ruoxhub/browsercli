#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_stealth_features',
  description: '列出隐身功能',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
