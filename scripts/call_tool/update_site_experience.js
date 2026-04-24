#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'update_site_experience',
  description: '更新站点经验',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
