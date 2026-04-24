#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_performance_now',
  description: 'Hook Performance Now',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
