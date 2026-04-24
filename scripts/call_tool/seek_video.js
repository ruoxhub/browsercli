#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'seek_video',
  description: '跳转视频',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
