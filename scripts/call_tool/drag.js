#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'drag',
  description: '拖拽',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
