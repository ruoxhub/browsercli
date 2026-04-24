#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'detect_crypto',
  description: '检测加密',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
