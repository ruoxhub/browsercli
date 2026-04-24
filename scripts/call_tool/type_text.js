#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'type_text',
  description: '输入文本',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
