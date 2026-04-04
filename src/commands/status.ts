#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {sendCommand} from '../daemon/client.js';

export async function statusCommand(): Promise<void> {
  try {
    const result = await sendCommand({method: 'status'});
    if (result.success) {
      const info = JSON.parse(result.result);
      console.log(`Daemon 状态：运行中 (PID: ${info.pid})`);
      console.log(`Socket: ${info.socketPath}`);
      console.log(`启动时间：${info.startDate}`);
      console.log(`参数：${info.args.join(' ')}`);
    } else {
      console.log('Daemon 未运行');
    }
  } catch (error) {
    console.error(
      `Daemon 未运行：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
