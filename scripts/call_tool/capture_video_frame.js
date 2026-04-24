#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'capture_video_frame',
  description: '捕获视频帧',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
