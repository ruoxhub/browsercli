/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker — 本地 daemon 进程入口
 *
 * 职责：
 * 1. 解析 CLI 参数并播种 RuntimeConfigStore
 * 2. 初始化 Runtime（创建 BrowserManager 实例但不自动连接）
 * 3. 初始化 ToolContextProvider（未连接状态）
 * 4. 启动 Web 控制台，以及供 CLI (browsercli) 通信的本机会话 IPC 命名管道
 */

import {buildDaemonArgPlan} from './ipc/daemonArgs.js';
import {runDaemon} from './worker/daemonMain.js';

/**
 * Worker 主函数
 */
async function main(): Promise<void> {
  const daemonPlan = buildDaemonArgPlan(process.argv.slice(2));
  await runDaemon(daemonPlan);
}

main().catch(err => {
  console.error('[Worker] 启动失败:', err);
  process.exit(1);
});
