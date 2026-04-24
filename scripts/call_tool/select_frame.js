#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'select_frame',
  description: '选择框架',
  callMode: 'runtime',
  schema: {
    frameIdx: 'number',
  },
  defaultParams: {
    frameIdx: 0,
  },
});
