#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'set_user_agent',
  description: '设置 User-Agent',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
