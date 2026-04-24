#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'fixed_window_size',
  description: '固定窗口大小',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
