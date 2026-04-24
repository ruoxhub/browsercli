#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_request_initiator',
  description: '获取请求发起者',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
