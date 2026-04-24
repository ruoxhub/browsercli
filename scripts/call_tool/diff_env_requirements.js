#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'diff_env_requirements',
  description: '差异环境需求',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
