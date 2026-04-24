#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'fill',
  description: '填充',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
