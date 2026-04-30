#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: 'export_rebuild_bundle',
  description: '导出重建包',
  callMode: 'params-only',
  schema: {},
  defaultParams: {},
});
