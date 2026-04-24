#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'bypass_debugger',
  description: '绕过调试',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
