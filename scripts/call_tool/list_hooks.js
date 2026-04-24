#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_hooks',
  description: '列出 Hook',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
