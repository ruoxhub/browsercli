/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker — 本地 daemon 进程入口（ADR-0006 / ADR-0008）
 *
 * 职责：
 * 1. 解析 daemon CLI 参数并播种 RuntimeConfigStore
 * 2. 直接构造 SessionContext + BrowserManager（零 getRuntime() 依赖）
 * 3. 启动供 browsercli 通信的本机会话 IPC 命名管道并写入注册表
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
