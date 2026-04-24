#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_vue_routes',
  description: '获取 Vue 路由',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
