#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_frames',
  description: '列出框架',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
