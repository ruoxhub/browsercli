#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'click',
  description: '点击元素',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
