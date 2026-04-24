#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'anti_anti_debug',
  description: '反反调试',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
