#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * browsercli CLI 入口 — 基于 axi-sdk-js runAxiCli 框架（纯远程 HTTP 客户端）
 *
 * 用法: browsercli <command> [options]
 *
 * Commands:
 *   call          调用工具或兼容技能
 *   list-tools    列出所有可用的 MCP 工具
 *   config        查看/设置/初始化全局配置
 *   scaffold      创建新的逆向任务脚手架
 */

import {runAxiCli} from 'axi-sdk-js';

import {
  cliCommands,
  cliDescription,
  cliVersion,
  createWorkerContext,
  homeCommand,
} from '../app.js';
import {generateCommandHelp, generateTopLevelHelp} from '../help.js';
import type {WorkerContext} from '../types.js';

void runAxiCli<WorkerContext>({
  description: cliDescription,
  version: cliVersion,
  topLevelHelp: generateTopLevelHelp(),
  commands: cliCommands,
  home: homeCommand,
  getCommandHelp: command => generateCommandHelp(command),
  resolveContext: createWorkerContext,
});
