#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'record_reverse_evidence',
  description: '记录逆向证据',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
