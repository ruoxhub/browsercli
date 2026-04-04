#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

// CLI 入口 - 懒加载模式
// 只有当用户实际执行命令时，才加载对应的命令模块
async function main() {
  const {createCli} = await import('../commands/index.js');
  const program = await createCli();
  program.parse(process.argv);
}

main().catch(error => {
  console.error('CLI 启动失败:', error);
  process.exit(1);
});
