#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'handle_dialog',
  description: '处理对话框',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
