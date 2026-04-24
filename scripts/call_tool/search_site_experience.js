#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'search_site_experience',
  description: '搜索站点经验',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
