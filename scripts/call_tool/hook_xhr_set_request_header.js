#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_xhr_set_request_header',
  description: 'Hook XHR Set Request Header',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
