#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'fill_form',
  description: '填写表单',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
