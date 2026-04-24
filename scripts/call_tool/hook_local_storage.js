#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_local_storage',
  description: 'Hook Local Storage',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
