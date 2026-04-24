#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'inject_stealth',
  description: '注入隐身',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
