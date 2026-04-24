#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_session_storage',
  description: 'Hook Session Storage',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
