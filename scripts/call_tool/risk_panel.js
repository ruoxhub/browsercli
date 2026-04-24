#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'risk_panel',
  description: '风险面板',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
