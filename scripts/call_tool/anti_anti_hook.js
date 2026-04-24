#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'anti_anti_hook',
  description: '反反 Hook',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
