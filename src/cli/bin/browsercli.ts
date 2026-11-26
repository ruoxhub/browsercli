#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';

import {runCli} from '../cli.js';

process.title = 'browsercli';

const code = await runCli();
if (code !== 0) {
  process.exit(code);
}
