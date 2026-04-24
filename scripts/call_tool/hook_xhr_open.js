#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_xhr_open',
  description: 'Hook XHR Open',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
