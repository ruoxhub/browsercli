#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'activate_vue_devtools',
  description: '激活 Vue Devtools',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
