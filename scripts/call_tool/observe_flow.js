#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'observe_flow',
  description:
    '观察模式：收集和分析页面脚本，识别加密和混淆代码，生成风险评估报告',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
