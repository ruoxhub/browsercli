#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_promise',
  description: 'Hook Promise',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
