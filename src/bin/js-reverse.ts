#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * js-reverse CLI 入口 — 基于 axi-sdk-js runAxiCli 框架
 *
 * 用法: js-reverse <command> [options]
 *
 * Commands:
 *   start         启动 Worker 并连接到 Sekiro Server
 *   stop          停止 Worker 进程
 *   status        查看 Worker 和 Sekiro 连接状态
 *   call          调用工具或兼容技能
 *   list-tools    列出所有可用的 MCP 工具及兼容技能映射
 *   config        查看/设置/初始化全局配置
 *   repl          启动交互式 REPL 模式
 *   scaffold      创建新的逆向任务脚手架
 */

import {runAxiCli} from 'axi-sdk-js';

import '../utils/logger.js';

import {
  cliCommands,
  cliDescription,
  cliVersion,
  createWorkerContext,
  homeCommand,
} from '../cli/app.js';
import {generateCommandHelp, generateTopLevelHelp} from '../cli/help.js';
import type {WorkerContext} from '../cli/types.js';

void runAxiCli<WorkerContext>({
  description: cliDescription,
  version: cliVersion,
  topLevelHelp: generateTopLevelHelp(),
  commands: cliCommands,
  home: homeCommand,
  hooks: false,
  getCommandHelp: command => generateCommandHelp(command),
  resolveContext: createWorkerContext,
});
