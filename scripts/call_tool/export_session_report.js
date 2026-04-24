#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'export_session_report',
  description: '导出会话报告',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
