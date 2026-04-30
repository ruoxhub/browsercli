#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_video_info',
  description: '获取视频信息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
