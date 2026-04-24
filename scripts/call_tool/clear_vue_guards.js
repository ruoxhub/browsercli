#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'clear_vue_guards',
  description: '清除 Vue 守卫',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
