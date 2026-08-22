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
  status: '查看 Worker 服务运行状态与统计信息',
};

export function generateTopLevelHelp(options?: {
  bin?: string;
  description?: string;
  version?: string;
  commands?: string[];
}): string {
  const bin = options?.bin ?? 'browsercli';
  const description = options?.description ?? '逆向工程CLI服务';
  const version = options?.version ?? '1.0.0';
  const commands = options?.commands ?? [
    'call',
    'list-tools',
    'browser',
    'jobs',
    'config',
    'scaffold',
    'status',
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
    '  Run browsercli <command> --help for more information on a command.',
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
        'browsercli call <tool-or-skill-name> [--param value] [--data <json>] [--file <params.json>]',
        'browsercli call evaluate_script --file <script.js>',
        'browsercli call <tool-or-skill-name> --stdin',
      ].join('\n         '),
    },
    browser: {
      description: '连接、断开或查看 Worker 浏览器状态',
      usage: [
        'browsercli browser connect [options]',
        'browsercli browser disconnect [--force] [--json]',
        'browsercli browser status [--json]',
      ].join('\n         '),
    },
    jobs: {
      description: '列出 Worker 任务，或取消卡住的活动任务',
      usage: [
        'browsercli jobs list [--json]',
        'browsercli jobs cancel <job-id> [--json]',
      ].join('\n         '),
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
    scaffold: {
      description: '创建新的逆向任务脚手架',
      usage:
        'browsercli scaffold --name <name> [--desc <description>] [--url <url>] [--output <directory>]',
    },
    status: {
      description: '查看 Worker 服务运行状态与统计信息',
      usage: 'browsercli status [--json]',
    },
  };

  const help = helpMap[command];
  if (!help) return null;

  return ['', `  Usage: ${help.usage}`, '', `  ${help.description}`, ''].join(
    '\n',
  );
}
