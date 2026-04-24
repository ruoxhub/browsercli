#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'export_rebuild_bundle',
  description: '导出重建包',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
