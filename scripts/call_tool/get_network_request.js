#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_network_request',
  description: '获取网络请求',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
