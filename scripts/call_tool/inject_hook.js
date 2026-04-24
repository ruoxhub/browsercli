#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'inject_hook',
  description: '注入 Hook',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
