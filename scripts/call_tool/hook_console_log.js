#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_console_log',
  description: 'Hook Console Log',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
