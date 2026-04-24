#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'break_on_xhr',
  description: 'XHR 断点',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
