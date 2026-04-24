#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'analyze_ast',
  description: '分析 AST',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
