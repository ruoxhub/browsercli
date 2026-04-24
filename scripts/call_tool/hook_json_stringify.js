#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_json_stringify',
  description: 'Hook JSON Stringify',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
