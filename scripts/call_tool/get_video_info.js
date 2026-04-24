#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'get_video_info',
  description: '获取视频信息',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
