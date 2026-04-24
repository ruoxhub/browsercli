#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'hook_location_href',
  description: 'Hook Location Href',
  callMode: 'frame',
  schema: {},
  defaultParams: {},
});
