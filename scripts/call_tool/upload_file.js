#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'upload_file',
  description: '上传文件',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
