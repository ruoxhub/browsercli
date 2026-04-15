#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {version} from 'node:process';

const [major, minor] = version.substring(1).split('.').map(Number);

const supported =
  (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;

if (!supported) {
  console.error(
    `ERROR: \`js-reverse-mcp\` does not support Node ${process.version}. Please upgrade to Node 20.19.0 LTS or a newer LTS.`,
  );
  process.exit(1);
}

await import('./daemon/daemon.js');
