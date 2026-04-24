#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_created_hooks',
  description: '列出已创建 Hook',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
