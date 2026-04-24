#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_history',
  description: 'Hook History',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
