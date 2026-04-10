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
    const message = error instanceof Error ? error.message : String(error);
    // 如果错误信息已经包含"未运行"等关键字，不再重复前缀
    if (message.includes('未运行')) {
      console.error(message);
    } else {
      console.error(`获取状态失败：${message}`);
    }
    process.exit(1);
  }
}
