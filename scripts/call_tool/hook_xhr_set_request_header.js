#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_xhr_set_request_header',
  description: 'Hook XHR Set Request Header',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
