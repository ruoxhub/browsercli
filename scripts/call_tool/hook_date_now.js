#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_date_now',
  description: 'Hook Date Now',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
