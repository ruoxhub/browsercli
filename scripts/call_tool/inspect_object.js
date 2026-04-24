#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'inspect_object',
  description: '检查对象',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
