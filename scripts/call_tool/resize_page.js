#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'resize_page',
  description: '调整页面大小',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
