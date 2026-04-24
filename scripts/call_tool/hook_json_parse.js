#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_json_parse',
  description: 'Hook JSON Parse',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
