#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'delete_site_experience',
  description: '删除站点经验',
  callMode: 'runtime',
  schema: {},
  defaultParams: {},
});
