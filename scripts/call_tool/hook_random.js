#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_random',
  description: 'Hook Random',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
