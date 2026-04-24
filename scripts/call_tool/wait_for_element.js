#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'wait_for_element',
  description: '等待元素',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
