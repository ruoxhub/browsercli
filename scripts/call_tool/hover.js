#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hover',
  description: '悬停',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
