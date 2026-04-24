#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_network_requests',
  description: '列出网络请求',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
