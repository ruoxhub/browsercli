/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI 帮助文本生成 — 供 runAxiCli 的 topLevelHelp 和 getCommandHelp 使用
 */

const commandDescriptions: Record<string, string> = {
  start: '启动或重启 daemon 会话（参考 chrome-devtools start）',
  stop: '停止 daemon 会话，支持 --all 停止全部（参考 chrome-devtools stop）',
  status: '查看 daemon 会话与浏览器运行状态（参考 chrome-devtools status）',
  call: '调用 MCP 工具，或兼容调用已迁移为 Tool 的旧技能',
  'list-tools': '列出所有可用的 MCP 工具及旧技能兼容映射',
  jobs: '列出或取消 Worker 工具任务',
  video: '录制和管理浏览器会话操作视频',
  config: '查看/设置/初始化全局配置',
  scaffold: '创建新的逆向任务脚手架',
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
    'start',
    'stop',
    'status',
    'call',
    'video',
    'list-tools',
    'jobs',
    'config',
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
    lines.push(desc ? `    ${cmd.padEnd(14)}${desc}` : `    ${cmd}`);
  }

  lines.push('');
  lines.push(
    `  Run ${bin} <command> --help for more information on a command.`,
  );
  lines.push('');

  return lines.join('\n');
}

const START_OPTIONS = [
  '  连接与目标选项（互斥）：',
  '    -u, --browserUrl, --browser-url <url> 连接正在运行的 Chrome 远程调试地址（如 http://127.0.0.1:9222）',
  '    -w, --wsEndpoint, --ws-endpoint <url> WebSocket 端点地址（如 ws://127.0.0.1:9222/devtools/browser/<id>）',
  '        --wsHeaders, --ws-headers <json>  WebSocket 连接自定义请求头（JSON 格式）',
  '        --autoConnect, --auto-connect     自动连接到本地运行的 Chrome 实例 (Chrome 144+)',
  '        --channel <name>                  本地启动浏览器渠道（stable, beta, dev, canary, chrome, firefox 等）',
  '    -e, --executablePath, --executable-path <path> 本地自定义浏览器可执行文件路径',
  '',
  '  浏览器运行与网络选项：',
  '        --headless[=<bool>]               是否以无头（无界面）模式运行（默认 false）',
  '        --isolated                        创建临时 user-data-dir，退出后自动清理',
  '        --userDataDir, --user-data-dir <dir> 指定 Chrome 用户数据目录',
  '        --proxyServer, --proxy-server <config> 为 Chrome 指定代理服务器（传递给 --proxy-server）',
  '        --chromeArg, --chrome-arg <args...> 传递给 Chrome 启动进程的附加参数',
  '        --ignoreDefaultChromeArg          显式禁用指定的 Chrome 默认参数',
  '        --acceptInsecureCerts, --accept-insecure-certs 忽略自签名和过期证书错误',
  '        --viewport <width>x<height>       窗口视口尺寸（如 1280x720，默认跟随系统屏幕）',
  '',
  '  工具分类开关（Category Flags）：',
  '        --categoryInput            启用/禁用输入相关工具（默认 true）',
  '        --categoryNavigation       启用/禁用导航相关工具（默认 true）',
  '        --categoryEmulation        启用/禁用仿真相关工具（默认 true）',
  '        --categoryPerformance      启用/禁用性能分析工具（默认 true）',
  '        --categoryNetwork          启用/禁用网络相关工具（默认 true）',
  '        --categoryDebugging        启用/禁用调试相关工具（默认 true）',
  '        --categoryExtensions       启用/禁用扩展相关工具（默认 true）',
  '        --categoryMemory           启用/禁用内存相关工具（默认 true）',
  '        --categoryPwa              启用/禁用 PWA 自动化工具（默认 false）',
  '        --categoryExperimentalThirdParty 启用第三方开发者工具扩展（默认 false）',
  '        --categoryExperimentalWebmcp 启用 WebMCP 实验性工具（默认 false）',
  '',
  '  截图与视觉选项：',
  '        --screenshotFormat <fmt>   默认截图格式（jpeg, png, webp，默认 png）',
  '        --screenshotQuality <0-100>截图压缩质量（仅针对 jpeg/webp）',
  '        --screenshotMaxWidth <px>  截图最大宽度（超宽时等比缩放）',
  '        --screenshotMaxHeight <px> 截图最大高度（超高时等比缩放）',
  '        --experimentalVision       启用基于坐标的视觉工具（如 click_at）',
  '',
  '  网络限制与安全：',
  '        --blockedUrlPattern <ptn..>限制网络访问，阻止指定 URL Pattern',
  '        --allowedUrlPattern <ptn..>限制网络访问，仅允许指定 URL Pattern (Chrome 149+)',
  '        --redactNetworkHeaders     在返回给客户端前脱敏敏感请求头（默认 false）',
  '        --maxNavigationSaved <num> 每个页面保留请求与控制台日志的导航次数（1-25，默认 3）',
  '',
  '  调试、日志与实验特性：',
  '        --logFile <path>           调试日志写入文件路径',
  '        --experimentalDevtools     允许通过 DevTools Targets 操作 DevTools 界面',
  '        --memoryDebugging          启用内存调试工具（默认 true）',
  '        --experimentalIncludeAllPages 包含 webviews 和 background pages 等全部页面',
  '        --experimentalScreencast   使用录屏功能',
  '        --screencastFps <num>      录屏帧率',
  '        --performanceCrux          是否将性能 trace URL 发送到 CrUX API（默认 true）',
  '        --usageStatistics          是否收集匿名使用统计（默认 true）',
  '        --javascriptEvaluation     是否允许执行调用方提供的 JavaScript（默认 true）',
  '        --fileNavigations          是否允许导航到 file: 协议 URL（默认 true）',
  '        --sourceMaps               是否在 DevTools 中启用 source maps（默认 true）',
  '',
  '  工作区与配置管理：',
  '        --workspace, --filesystemRoot <dir> 允许文件系统工具访问的目录',
  '        --allowUnrestrictedPaths   解除对受限工作区外的路径访问限制',
  '        --config <path>            指定 JSON 配置文件路径',
  '        --watchConfig              监听配置文件变更并热重载生效',
  '',
  '  反检测与伪装选项（BrowserCLI 增强）：',
  '        --cloak                    启用 CloakBrowser 源码级反检测二进制（49 个 C++ patch）',
  '        --minimal-stealth          启用最小反爬检测启动参数（默认推荐）',
  '        --full-stealth-args        启用全量隐身启动参数（包含历史反爬特征参数）',
  '        --js-stealth               注入 StealthScripts2025 JS 反反爬脚本',
  '',
  '  输出选项：',
  '        --json                     以 JSON 格式输出结果',
].join('\n');

export function generateCommandHelp(
  command: string,
  _subCommandOrArgs?: string | readonly string[],
): string | null {
  const helpMap: Record<
    string,
    {description: string; usage: string; options?: string}
  > = {
    start: {
      description:
        '启动或重启 daemon 会话。支持直接传入浏览器连接与反检测选项（如 --channel, --browser-url, --headless 等）。',
      usage: 'browsercli [-s=<session>] start [options]',
      options: START_OPTIONS,
    },
    stop: {
      description:
        '停止 daemon 会话。默认停止当前会话，指定 --all 可强杀全部 daemon 进程。',
      usage: ['browsercli [-s=<session>] stop', 'browsercli stop --all'].join(
        '\n         ',
      ),
    },
    status: {
      description:
        '检查 daemon 会话及浏览器连接状态，展示当前会话详情及运行中的全部会话列表。',
      usage: 'browsercli [-s=<session>] status [--json]',
    },
    call: {
      description:
        '调用 MCP 工具。复杂或多行 JavaScript 请保存为脚本文件后使用 --file，或通过 --stdin 传入 JSON 参数，避免 shell 转义破坏脚本。',
      usage: [
        'browsercli call <tool-or-skill-name> [--param value] [--data <json>] [--file <params.json>]',
        'browsercli call evaluate_script --file <script.js>',
        'browsercli call <tool-or-skill-name> --stdin',
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
