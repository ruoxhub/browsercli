#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_close',
  description: 'Hook Close',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
