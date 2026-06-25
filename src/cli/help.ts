/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI 帮助文本生成 — 供 runAxiCli 的 topLevelHelp 和 getCommandHelp 使用
 */

const commandDescriptions: Record<string, string> = {
  start: '启动 Worker 并连接到 Sekiro Server',
  stop: '停止 Worker 进程',
  status: '查看 Worker 和 Sekiro 连接状态',
  call: '调用 MCP 工具，或兼容调用已迁移为 Tool 的旧技能',
  config: '查看/设置/初始化全局配置',
  'list-tools': '列出所有可用的 MCP 工具及旧技能兼容映射',
  repl: '启动交互式 REPL 模式',
  scaffold: '创建新的逆向任务脚手架',
};

export function generateTopLevelHelp(options?: {
  bin?: string;
  description?: string;
  version?: string;
  commands?: string[];
}): string {
  const bin = options?.bin ?? 'browsercli';
  const description =
    options?.description ?? '逆向工程CLI服务';
  const version = options?.version ?? '1.0.0';
  const commands = options?.commands ?? [
    'start',
    'stop',
    'status',
    'call',
    'list-tools',
    'config',
    'repl',
    'scaffold',
  ];

  const lines = [
    `\n  ${bin} v${version}`,
    `  ${description}`,
    '',
    '  Commands:',
  ];

  for (const cmd of commands) {
    const desc = commandDescriptions[cmd];
    lines.push(
      desc ? `    ${cmd.padEnd(14)}${desc}` : `    ${cmd}`,
    );
  }

  lines.push('');
  lines.push(
    '  Run browsercli <command> --help for more information on a command.',
  );
  lines.push('');

  return lines.join('\n');
}

export function generateCommandHelp(command: string): string | null {
  const helpMap: Record<string, {description: string; usage: string}> = {
    start: {
      description: '启动 Worker 并连接到 Sekiro Server，自动打开 Web 控制台',
      usage:
        'browsercli start [--browserUrl <url>] [--wsEndpoint <endpoint>] [--rpcHost <host>] [--group <name>] [--wait-for-browser] [--headless] [--cloak] [--js-stealth] [--full-stealth-args] [--no-open] [--console-port <port>]',
    },
    stop: {
      description: '停止 Worker 进程',
      usage: 'browsercli stop',
    },
    status: {
      description: '查看 Worker 和 Sekiro 连接状态',
      usage: 'browsercli status',
    },
    call: {
      description: '调用 MCP 工具，或兼容调用已迁移为 Tool 的旧技能',
      usage:
        'browsercli call <tool-or-skill-name> [--param value] [--url <url>] [--data <json>]',
    },
    config: {
      description: '查看/设置/初始化全局配置',
      usage:
        'browsercli config [--init] [--set key=value] [--get key] [--unset key] [--list]',
    },
    'list-tools': {
      description: '列出所有可用的 MCP 工具及旧技能兼容映射',
      usage: 'browsercli list-tools [--json]',
    },
    repl: {
      description: '启动交互式 REPL 模式',
      usage: 'browsercli repl',
    },
    scaffold: {
      description: '创建新的逆向任务脚手架',
      usage:
        'browsercli scaffold --name <name> [--desc <description>] [--url <url>] [--output <directory>]',
    },
  };

  const help = helpMap[command];
  if (!help) return null;

  return [
    '',
    `  Usage: ${help.usage}`,
    '',
    `  ${help.description}`,
    '',
  ].join('\n');
}
