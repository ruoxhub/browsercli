#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_history_go',
  description: 'Hook History Go',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
