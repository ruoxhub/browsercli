#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'rebuild_bundle',
  description: '本地复现：构建 Node.js 环境复现目标代码，支持参数提取上下文',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
