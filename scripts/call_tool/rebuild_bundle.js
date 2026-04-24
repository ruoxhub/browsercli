#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'rebuild_bundle',
  description: '本地复现：构建 Node.js 环境复现目标代码，支持参数提取上下文',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
