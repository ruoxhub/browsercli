#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'list_site_experiences',
  description: '列出站点经验',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
