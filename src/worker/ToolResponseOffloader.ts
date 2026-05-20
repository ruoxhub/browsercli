/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {DetailedDataManager} from '../utils/detailedDataManager.js';

export class ToolResponseOffloader {
  constructor(
    private readonly manager = DetailedDataManager.getInstance(),
    private readonly thresholdBytes = 512 * 1024,
  ) {}

  handle(response: unknown): unknown {
    return this.manager.smartHandle(response, this.thresholdBytes);
  }
}
