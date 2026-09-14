/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI 帮助文本生成 — 供 runAxiCli 的 topLevelHelp 和 getCommandHelp 使用
 */

const commandDescriptions: Record<string, string> = {
  call: '调用 MCP 工具，或兼容调用已迁移为 Tool 的旧技能',
  browser: '连接、断开或查看 Worker 浏览器状态',
  jobs: '列出或取消 Worker 工具任务',
  config: '查看/设置/初始化全局配置',
  'list-tools': '列出所有可用的 MCP 工具及旧技能兼容映射',
  scaffold: '创建新的逆向任务脚手架',
  status: '查看 daemon 会话运行状态',
  proxy: '启动交互式 MITM 代理抓包终端（REPL）或查看代理状态',
  web: '启动、查看或停止 Web 控制台',
  open: '拉起（或探活）daemon 会话',
  close: '停止 daemon 会话',
  list: '列出注册表中的全部 daemon 会话',
  'kill-all': '强杀全部 daemon 进程并清理会话注册表',
};

export function generateTopLevelHelp(options?: {
  bin?: string;
  description?: string;
  version?: string;
  commands?: string[];
}): string {
  const bin = options?.bin ?? 'proxycli';
  const description = options?.description ?? '逆向工程CLI服务';
  const version = options?.version ?? '1.0.0';
  const commands = options?.commands ?? [
    'open',
    'close',
    'list',
    'kill-all',
    'call',
    'list-tools',
    'browser',
    'jobs',
    'config',
    'scaffold',
    'status',
    'proxy',
    'web',
  ];

  const lines = [
    `\n  ${bin} v${version}`,
    `  ${description}`,
    '',
    '  Commands:',
  ];

  for (const cmd of commands) {
    const desc = commandDescriptions[cmd];
    lines.push(desc ? `    ${cmd.padEnd(14)}${desc}` : `    ${cmd}`);
  }

  lines.push('');
  lines.push(
    `  Run ${bin} <command> --help for more information on a command.`,
  );
  lines.push('');

  return lines.join('\n');
}

export function generateCommandHelp(command: string): string | null {
  const helpMap: Record<string, {description: string; usage: string}> = {
    call: {
      description:
        '调用 MCP 工具。复杂或多行 JavaScript 请保存为脚本文件后使用 --file，或通过 --stdin 传入 JSON 参数，避免 shell 转义破坏脚本。',
      usage: [
        'proxycli call <tool-or-skill-name> [--param value] [--data <json>] [--file <params.json>]',
        'proxycli call evaluate_script --file <script.js>',
        'proxycli call <tool-or-skill-name> --stdin',
      ].join('\n         '),
    },
    browser: {
      description: '连接、断开或查看 Worker 浏览器状态',
      usage: [
        'proxycli browser connect [options]',
        'proxycli browser disconnect [--force] [--json]',
        'proxycli browser status [--json]',
      ].join('\n         '),
    },
    jobs: {
      description: '列出 Worker 任务，或取消卡住的活动任务',
      usage: [
        'proxycli jobs list [--json]',
        'proxycli jobs cancel <job-id> [--json]',
      ].join('\n         '),
    },
    config: {
      description: '查看/设置/初始化全局配置',
      usage:
        'proxycli config [--init] [--set key=value] [--get key] [--unset key] [--list]',
    },
    'list-tools': {
      description: '列出所有可用的 MCP 工具及旧技能兼容映射',
      usage: 'proxycli list-tools [--json]',
    },
    scaffold: {
      description: '创建新的逆向任务脚手架',
      usage:
        'proxycli scaffold --name <name> [--desc <description>] [--url <url>] [--output <directory>]',
    },
    status: {
      description: '查看 daemon 会话运行状态（读注册表并逐会话探活）',
      usage: 'proxycli status [--json]',
    },
    proxy: {
      description: '启动交互式 MITM 代理抓包终端（REPL）或查看状态',
      usage:
        'proxycli proxy [status] [--port=<port>] [--upstream=<url>] [--sysproxy] [--no-auto-start]',
    },
    open: {
      description:
        '拉起（或探活）daemon 会话。连不上注册表里的 socket 时自动 spawn detached daemon',
      usage: 'proxycli [-s=<session>] open',
    },
    close: {
      description: '停止 daemon 会话（请求 stop，兜底 pid 探活清理注册表）',
      usage: 'proxycli [-s=<session>] close',
    },
    list: {
      description: '列出当前 workspace 注册表中的全部 daemon 会话',
      usage: 'proxycli list',
    },
    'kill-all': {
      description: '强杀全部 --proxycli-daemon 进程并清理会话注册表',
      usage: 'proxycli kill-all',
    },
    web: {
      description:
        '启动、查看或停止 Web 控制台（启动时如果 daemon 未运行则自动拉起）',
      usage: [
        'proxycli [-s=<session>] web [start] [--port=<port>] [--no-open] [--json]',
        'proxycli [-s=<session>] web status [--json]',
        'proxycli [-s=<session>] web stop [--json]',
      ].join('\n         '),
    },
  };

  const help = helpMap[command];
  if (!help) return null;

  return ['', `  Usage: ${help.usage}`, '', `  ${help.description}`, ''].join(
    '\n',
  );
}
