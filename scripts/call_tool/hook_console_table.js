#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_console_table',
  description: 'Hook Console Table',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
