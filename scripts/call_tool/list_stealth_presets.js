#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_stealth_presets',
  description: '列出隐身预设',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
