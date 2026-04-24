#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'click_element',
  description: '点击元素',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
