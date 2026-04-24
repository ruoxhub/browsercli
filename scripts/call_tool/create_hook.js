#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'create_hook',
  description: '创建 Hook',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
