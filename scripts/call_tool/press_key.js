#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'press_key',
  description: '按键',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
