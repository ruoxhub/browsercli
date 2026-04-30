#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_request_initiator',
  description: '获取请求发起者',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
