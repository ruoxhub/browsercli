#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'set_files',
  description: '设置文件',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
