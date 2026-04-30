#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'capture_video_frame',
  description: '捕获视频帧',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
