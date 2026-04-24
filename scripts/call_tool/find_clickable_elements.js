#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'find_clickable_elements',
  description: '查找可点击元素',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
