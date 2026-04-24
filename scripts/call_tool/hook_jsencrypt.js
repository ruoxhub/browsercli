#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_jsencrypt',
  description: 'Hook JSEncrypt',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
