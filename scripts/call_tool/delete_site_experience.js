#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'delete_site_experience',
  description: '删除站点经验',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
