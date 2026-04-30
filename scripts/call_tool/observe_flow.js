#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'observe_flow',
  description:
    '观察模式：收集和分析页面脚本，识别加密和混淆代码，生成风险评估报告',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
