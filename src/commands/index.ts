#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {Command} from 'commander';
import {VERSION} from '../version.js';
import {generateToolCommands} from './tool-commands.js';

export async function createCli(): Promise<Command> {
  const program = new Command('js-reverse');

  program
    .version(VERSION)
    .description('JavaScript 逆向工程 CLI 工具 - 删除 MCP 模式，纯 CLI 架构')
    .showHelpAfterError();

  // Daemon 控制命令 - 懒加载 action
  program
    .command('start')
    .description('启动后台服务')
    .option('--browserUrl <url>', '连接现有 Chrome 实例')
    .option('--wsEndpoint <endpoint>', '通过 WebSocket 连接')
    .option('--headless', '无头模式')
    .option('--executablePath <path>', '自定义 Chrome 路径')
    .option('--http', '启用 HTTP 模式')
    .option('--port <port>', 'HTTP 端口', '3000')
    .action(async options => {
      const {startCommand} = await import('./start.js');
      await startCommand(options);
    });

  program
    .command('stop')
    .description('停止后台服务')
    .action(async () => {
      const {stopCommand} = await import('./stop.js');
      await stopCommand();
    });

  program
    .command('status')
    .description('查看服务状态')
    .action(async () => {
      const {statusCommand} = await import('./status.js');
      await statusCommand();
    });

  // 技能调用命令 - 懒加载 action
  program
    .command('call-skill <name>')
    .description('调用技能')
    .option('--url <url>', '目标 URL')
    .option('--data <data>', '附加数据 (JSON)')
    .action(async (name, options) => {
      const {callSkillCommand} = await import('./call-skill.js');
      await callSkillCommand(name, options);
    });

  // 工具调用命令 - 懒加载 action (保留向后兼容)
  program
    .command('call-tool <name>')
    .description('调用工具 (已废弃，请直接使用工具名作为子命令)')
    .option(
      '--param <key=value>',
      '工具参数',
      (val, previous: string[]) => (previous ? [...previous, val] : [val]),
      [],
    )
    .option('--url <url>', '目标 URL')
    .action(async (name, options) => {
      const {callToolCommand} = await import('./call-tool.js');
      await callToolCommand(name, options);
    });

  // 列表命令 - 懒加载 action
  program
    .command('list-skills')
    .description('列出所有可用技能')
    .option('--json', 'JSON 格式输出')
    .action(async options => {
      const {listSkillsCommand} = await import('./list-skills.js');
      await listSkillsCommand(options);
    });

  program
    .command('list-tools')
    .description('列出所有可用工具')
    .option('--json', 'JSON 格式输出')
    .action(async options => {
      const {listToolsCommand} = await import('./list-tools.js');
      await listToolsCommand(options);
    });

  // 交互模式 - 懒加载 action
  program
    .command('repl')
    .description('进入交互模式')
    .option('--browserUrl <url>', '连接现有 Chrome 实例')
    .action(async options => {
      const {replCommand} = await import('./repl.js');
      await replCommand(options);
    });

  // 脚手架命令 - 懒加载 action
  program
    .command('scaffold')
    .description('创建新任务脚手架')
    .requiredOption('--name <name>', '任务名称')
    .option('--desc <desc>', '任务描述')
    .option('--url <url>', '目标 URL')
    .option('--output <dir>', '输出目录')
    .action(async options => {
      const {scaffoldCommand} = await import('./scaffold.js');
      await scaffoldCommand(options);
    });

  // 动态生成所有工具命令 - 懒加载，不导入重型模块
  await generateToolCommands(program);

  return program;
}
