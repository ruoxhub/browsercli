#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_console_protect',
  description: 'Hook Console Protect',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
