#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_cookie',
  description: 'Hook Cookie',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
