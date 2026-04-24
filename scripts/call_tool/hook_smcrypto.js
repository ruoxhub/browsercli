#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_smcrypto',
  description: 'Hook SMCrypto',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
