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
 *   call          调用 MCP 工具
 *   call-skill    调用逆向工程技能
 *   list-tools    列出所有可用的 MCP 工具
 *   list-skills   列出所有可用的逆向工程技能
 *   config        查看/设置/初始化全局配置
 *   repl          启动交互式 REPL 模式
 *   scaffold      创建新的逆向任务脚手架
 */

import {runAxiCli, type AxiCliCommand} from 'axi-sdk-js';
import {resolveConfig} from '../config.js';
import {SekiroInvoker} from '../cli/sekiro-invoker.js';
import {WorkerManager} from '../cli/worker-manager.js';
import {generateTopLevelHelp, generateCommandHelp} from '../cli/help.js';
import {startCommand} from '../cli/commands/start.js';
import {stopCommand} from '../cli/commands/stop.js';
import {statusCommand} from '../cli/commands/status.js';
import {listSkillsCommand} from '../cli/commands/list-skills.js';
import {listToolsCommand} from '../cli/commands/list-tools.js';
import {callSkillCommand} from '../cli/commands/call-skill.js';
import {scaffoldCommand} from '../cli/commands/scaffold.js';
import {replCommand} from '../cli/commands/repl.js';
import {toolDispatcherCommand} from '../cli/commands/tool-dispatcher.js';
import {configCommand} from '../cli/commands/config.js';
import type {WorkerContext} from '../cli/types.js';

const commands: Record<string, AxiCliCommand<WorkerContext>> = {
  start: startCommand,
  stop: stopCommand,
  status: statusCommand,
  call: toolDispatcherCommand,
  'call-skill': callSkillCommand,
  'list-tools': listToolsCommand,
  'list-skills': listSkillsCommand,
  config: configCommand,
  repl: replCommand,
  scaffold: scaffoldCommand,
};

/** 默认命令（无子命令时显示帮助） */
const homeCommand: AxiCliCommand<WorkerContext> = async () => {
  return generateTopLevelHelp();
};

runAxiCli<WorkerContext>({
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
