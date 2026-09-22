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
  const bin = options?.bin ?? 'browsercli';
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

const BROWSER_CONNECT_USAGE =
  'browsercli browser connect [--browser-url <url> | --ws-endpoint <url> | --channel <name> | --executable-path <path>] [--user-data-dir <dir>] [--viewport <width>x<height>] [--ws-headers <json>] [--headless[=<bool>]] [--cloak] [--minimal-stealth] [--full-stealth-args] [--js-stealth] [--isolated] [--accept-insecure-certs] [--force] [--json]';

const BROWSER_CONNECT_OPTIONS = [
  '  目标参数（互斥）：',
  '    --browser-url <url>            CDP HTTP 远程调试入口（如 http://127.0.0.1:9222）',
  '    --ws-endpoint <url>            CDP WebSocket 远程连接地址',
  '    --channel <name>               本地启动浏览器渠道（stable, beta, canary, chrome, firefox 等）',
  '    --executable-path <path>       本地自定义浏览器可执行文件路径',
  '',
  '  运行与环境选项：',
  '    --user-data-dir <dir>          浏览器 Profile 用户数据目录',
  '    --viewport <width>x<height>    窗口视口尺寸（如 1280x720，默认跟随系统屏幕）',
  '    --ws-headers <json>            远程 WebSocket 握手请求头（JSON 字符串）',
  '    --headless[=<bool>]            是否以无头模式运行（默认 false）',
  '    --isolated                     是否使用隔离会话上下文',
  '    --accept-insecure-certs        允许不受信任的 HTTPS 证书',
  '    --force                        若已存在活动连接，强制关闭后重新连接',
  '',
  '  反检测与伪装选项：',
  '    --cloak                        启用 CloakBrowser 源码级反检测二进制（49 个 C++ patch，profile 物理隔离）',
  '    --minimal-stealth              启用最小反爬检测启动参数（默认推荐）',
  '    --full-stealth-args            启用全量隐身启动参数（包含历史反爬特征参数）',
  '    --js-stealth                   注入 StealthScripts2025 JS 反反爬脚本',
  '',
  '  输出选项：',
  '    --json                         以 JSON 格式输出结果',
].join('\n');

export function generateCommandHelp(
  command: string,
  subCommandOrArgs?: string | readonly string[],
): string | null {
  const subCommand =
    typeof subCommandOrArgs === 'string'
      ? subCommandOrArgs
      : Array.isArray(subCommandOrArgs)
        ? subCommandOrArgs.find(arg => !arg.startsWith('-'))
        : undefined;

  if (command === 'browser' && subCommand) {
    if (subCommand === 'connect') {
      return [
        '',
        `  Usage: ${BROWSER_CONNECT_USAGE}`,
        '',
        '  连接 Worker 浏览器（支持 CDP 远程附连、本地启动与反检测模式）',
        '',
        '  Options:',
        BROWSER_CONNECT_OPTIONS,
        '',
      ].join('\n');
    }
    if (subCommand === 'disconnect') {
      return [
        '',
        '  Usage: browsercli browser disconnect [--force] [--json]',
        '',
        '  断开 Worker 浏览器连接',
        '',
        '  Options:',
        '    --force                        强制断开连接（忽略未完成的任务）',
        '    --json                         以 JSON 格式输出结果',
        '',
      ].join('\n');
    }
    if (subCommand === 'status') {
      return [
        '',
        '  Usage: browsercli browser status [--json]',
        '',
        '  查看 Worker 浏览器连接状态',
        '',
        '  Options:',
        '    --json                         以 JSON 格式输出结果',
        '',
      ].join('\n');
    }
  }

  const helpMap: Record<
    string,
    {description: string; usage: string; options?: string}
  > = {
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
        BROWSER_CONNECT_USAGE,
        'browsercli browser disconnect [--force] [--json]',
        'browsercli browser status [--json]',
      ].join('\n         '),
      options: BROWSER_CONNECT_OPTIONS,
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
      description: '查看 daemon 会话运行状态（读注册表并逐会话探活）',
      usage: 'browsercli status [--json]',
    },
    open: {
      description:
        '拉起（或探活）daemon 会话。连不上注册表里的 socket 时自动 spawn detached daemon',
      usage: 'browsercli [-s=<session>] open',
    },
    close: {
      description: '停止 daemon 会话（请求 stop，兜底 pid 探活清理注册表）',
      usage: 'browsercli [-s=<session>] close',
    },
    list: {
      description: '列出当前 workspace 注册表中的全部 daemon 会话',
      usage: 'browsercli list',
    },
    'kill-all': {
      description: '强杀全部 --browsercli-daemon 进程并清理会话注册表',
      usage: 'browsercli kill-all',
    },
    web: {
      description:
        '启动、查看或停止 Web 控制台（启动时如果 daemon 未运行则自动拉起）',
      usage: [
        'browsercli [-s=<session>] web [start] [--port=<port>] [--no-open] [--json]',
        'browsercli [-s=<session>] web status [--json]',
        'browsercli [-s=<session>] web stop [--json]',
      ].join('\n         '),
    },
  };

  const help = helpMap[command];
  if (!help) return null;

  const lines = ['', `  Usage: ${help.usage}`, '', `  ${help.description}`];
  if (help.options) {
    lines.push('', '  Options:', help.options);
  }
  lines.push('');
  return lines.join('\n');
}
