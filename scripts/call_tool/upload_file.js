#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'upload_file',
  description: '上传文件',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
