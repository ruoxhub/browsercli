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
 *   call          调用 MCP 工具或兼容技能
 *   list-tools    列出所有可用的 MCP 工具及兼容技能映射
 *   config        查看/设置/初始化全局配置
 *   repl          启动交互式 REPL 模式
 *   scaffold      创建新的逆向任务脚手架
 */

import {runAxiCli, type AxiCliCommand} from 'axi-sdk-js';

import {configCommand} from '../cli/commands/config.js';
import {listToolsCommand} from '../cli/commands/list-tools.js';
import {replCommand} from '../cli/commands/repl.js';
import {scaffoldCommand} from '../cli/commands/scaffold.js';
import {startCommand} from '../cli/commands/start.js';
import {statusCommand} from '../cli/commands/status.js';
import {stopCommand} from '../cli/commands/stop.js';
import {toolDispatcherCommand} from '../cli/commands/tool-dispatcher.js';
import {generateCommandHelp, generateTopLevelHelp} from '../cli/help.js';
import {SekiroInvoker} from '../cli/sekiro-invoker.js';
import type {WorkerContext} from '../cli/types.js';
import {WorkerManager} from '../cli/worker-manager.js';
import {resolveConfig} from '../config.js';

const commands: Record<string, AxiCliCommand<WorkerContext>> = {
  start: startCommand,
  stop: stopCommand,
  status: statusCommand,
  call: toolDispatcherCommand,
  'list-tools': listToolsCommand,
  config: configCommand,
  repl: replCommand,
  scaffold: scaffoldCommand,
};

/** 默认命令（无子命令时显示帮助） */
const homeCommand: AxiCliCommand<WorkerContext> = async () => {
  return generateTopLevelHelp();
};

void runAxiCli<WorkerContext>({
  description: 'JS逆向工程MCP服务 — 标准化前端JavaScript逆向流程',
  version: '2.0.3',
  topLevelHelp: generateTopLevelHelp(),
  commands,
  home: homeCommand,
  hooks: false,
  getCommandHelp: command => generateCommandHelp(command),
  resolveContext: () => {
    const resolvedConfig = resolveConfig();
    const invoker = new SekiroInvoker({sekiroHost: resolvedConfig.sekiroHost});
    const workerManager = new WorkerManager();

    const ctx: WorkerContext = {
      sekiroHost: resolvedConfig.sekiroHost,
      group: resolvedConfig.group,
      invoker,
      workerManager,
      resolvedConfig,
      config: {
        browserUrl: resolvedConfig.browserUrl,
        wsEndpoint: resolvedConfig.wsEndpoint,
        headless: resolvedConfig.headless,
        executablePath: resolvedConfig.executablePath,
      },
    };
    return ctx;
  },
});
