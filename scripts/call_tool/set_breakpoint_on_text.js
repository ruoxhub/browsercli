#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'set_breakpoint_on_text',
  description: '在文本上设置断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
