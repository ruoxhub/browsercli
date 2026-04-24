#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_fetch',
  description: 'Hook Fetch',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
