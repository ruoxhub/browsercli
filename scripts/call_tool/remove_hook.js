#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'remove_hook',
  description: '移除 Hook',
  callMode: 'frame',
  schema: {hookId: 'string'},
  defaultParams: {hookId: 'hook_id_here'},
});
