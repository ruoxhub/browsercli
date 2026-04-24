#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'deobfuscate_code_vj',
  description: '去混淆代码 (v_jstools)',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
