#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_dom_structure',
  description: '获取 DOM 结构',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
