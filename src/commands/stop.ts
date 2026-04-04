#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {sendCommand} from '../daemon/client.js';

export async function stopCommand(): Promise<void> {
  try {
    console.log('停止 Daemon 服务...');
    const result = await sendCommand({method: 'stop'});
    if (result.success) {
      console.log('Daemon 已停止');
    } else {
      console.error(`停止失败：${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `停止失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
