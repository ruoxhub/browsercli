#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'create_site_experience',
  description: '创建站点经验',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
