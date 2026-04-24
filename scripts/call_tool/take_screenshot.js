#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'take_screenshot',
  description: '截图',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
