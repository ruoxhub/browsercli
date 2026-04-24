#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_site_experiences',
  description: '列出站点经验',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
