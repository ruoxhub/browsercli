#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_console_clear',
  description: 'Hook Console Clear',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
