#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * browsercli CLI 入口 — 基于 axi-sdk-js runAxiCli 框架（daemon socket 客户端）
 *
 * 用法: browsercli [-s=<session>] <command> [options]
 *
 * Commands:
 *   open          拉起（或探活）daemon 会话
 *   close         停止 daemon 会话
 *   list          列出注册表中的全部会话
 *   kill-all      强杀全部 daemon 进程
 *   call          调用工具或兼容技能
 *   list-tools    列出所有可用的 MCP 工具
 *   browser       控制 Worker 浏览器连接
 *   jobs          列出/取消工具任务
 *   config        查看/设置/初始化全局配置
 *   scaffold      创建新的逆向任务脚手架
 *   status        查看 daemon 会话状态
 *   web           启动、查看或停止 Web 控制台
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
import {extractLeadingSession} from '../sessionArgs.js';
import type {WorkerContext} from '../types.js';

// runAxiCli 要求 flag 位于命令之后；`browsercli -s=x open` 式前置会话 flag
// 先摘出来（仍保留在完整 argv 中供 createWorkerContext 解析），rest 交给 SDK。
const rawArgv = process.argv.slice(2);
const {rest} = extractLeadingSession(rawArgv);

void runAxiCli<WorkerContext>({
  description: cliDescription,
  version: cliVersion,
  topLevelHelp: generateTopLevelHelp(),
  commands: cliCommands,
  home: homeCommand,
  getCommandHelp: command => generateCommandHelp(command, rest.slice(1)),
  argv: rest,
  resolveContext: () => createWorkerContext(rawArgv),
});
