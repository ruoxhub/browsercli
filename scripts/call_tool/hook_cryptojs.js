#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_cryptojs',
  description: 'Hook CryptoJS',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
