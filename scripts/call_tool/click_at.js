#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'click_at',
  description: '在坐标点击',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
