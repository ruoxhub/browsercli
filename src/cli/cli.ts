/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * browsercli 单入口 yargs CLI（参考 chrome-devtools-mcp/src/bin/chrome-devtools.ts）。
 * 统一承载 start / stop / status、静态工具一级命令及扩展子命令。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import yargs from 'yargs';
import type {Options, PositionalOptions} from 'yargs';

import {
  buildCommandPatterns,
  buildToolCommand,
  getToolArgSpec,
  isSyntheticPositionalSlot,
  shieldLiteralArgs,
  type CommandArgSpec,
} from './cliCommands.js';
import {runConfig} from './commands.js';
import {
  CLI_VERSION,
  collectSessionRows,
  DaemonConnection,
  ensureDaemon,
  killAllDaemons,
  probeSession,
  stopSession,
  verifyDaemonVersion,
  type DaemonLike,
} from './daemonClient.js';
import {DEPRECATED_HINTS} from './deprecatedHints.js';
import {
  assertValidSessionName,
  computeClientInfo,
  deleteSession,
  listSessions,
  loadCliConfig,
  loadSession,
  resolveSessionName,
} from './sessionPaths.js';
import {
  buildBrowserConnectOptions,
  hasExplicitBrowserFlags,
  serializeStartFlags,
  START_YARGS_OPTIONS,
} from './startOptions.js';
import type {ToolMeta} from './tool-meta-types.js';
import {CliError, invokeTool} from './toolInvoke.js';
import {loadStaticToolsManifest} from './tools-manifest-loader.js';
import type {BrowserConnectionStatus} from './types.js';

const RESERVED_COMMANDS = new Set([
  'start',
  'stop',
  'status',
  'config',
  ...Object.keys(DEPRECATED_HINTS),
]);

/**
 * 预处理原始 argv（委托 `shieldLiteralArgs`）：
 * 保护 `--` 后的全部参数、孤立 `-`，以及未填满位置槽位中 `-` 开头的非已知选项字面量，
 * 防止 yargs 将其误判为选项。
 */
export function preprocessArgv(
  rawArgv: readonly string[],
  getSpec?: (commandName: string) => CommandArgSpec | undefined,
): {
  argv: string[];
  restore: (val: unknown) => unknown;
} {
  return shieldLiteralArgs(rawArgv, getSpec);
}

export interface CliDeps {
  daemonDir?: string;
  connect?: (session: string, spawnFlags: string[]) => Promise<DaemonLike>;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
  exit?: (code: number) => void;
  tools?: ToolMeta[];
}

function defaultConnect(
  session: string,
  spawnFlags: string[],
  daemonDir?: string,
): Promise<DaemonLike> {
  return (async () => {
    const cfg = await ensureDaemon({session, spawnFlags, daemonDir});
    const conn = await DaemonConnection.connect(cfg.socketPath, 3000);
    void verifyDaemonVersion(session, CLI_VERSION, daemonDir)
      .then(warn => {
        if (warn) console.warn(warn);
      })
      .catch(() => undefined);
    return conn;
  })();
}

async function connectBrowserWithRetry(
  socketPath: string,
  body: Record<string, unknown>,
): Promise<BrowserConnectionStatus> {
  const client = await DaemonConnection.connect(socketPath, 3000);
  try {
    const startTime = Date.now();
    for (;;) {
      try {
        return await client.request<BrowserConnectionStatus>(
          'browser.connect',
          {body},
        );
      } catch (err) {
        if (
          err instanceof Error &&
          /WORKER_BUSY/.test(err.message) &&
          /browser connect/.test(err.message)
        ) {
          if (Date.now() - startTime < 35_000) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          throw new Error(
            '[WORKER_BUSY] Worker 正在连接浏览器中，请留意 Chrome 授权弹窗或稍后运行 "browsercli status"。',
          );
        }
        throw err;
      }
    }
  } finally {
    client.close();
  }
}

function addToolControlOptions(y: ReturnType<typeof yargs>) {
  return y
    .option('output-format', {
      choices: ['toon', 'md', 'json'] as const,
      describe: '输出格式（默认 toon；可选 md 紧凑 Markdown / json 原始结构）',
    })
    .option('json', {type: 'boolean', describe: '等价于 --output-format json'})
    .option('toon', {type: 'boolean', describe: '等价于 --output-format toon'})
    .option('data', {type: 'string', describe: '直接以 JSON 对象传参'})
    .option('file', {type: 'string', describe: '从 .json 或 .js 文件加载参数'})
    .option('stdin', {type: 'boolean', describe: '从标准输入读取 JSON 参数'})
    .option('watch', {type: 'boolean', describe: '实时流式打印执行期间事件'});
}

function extractControlFlags(argv: Record<string, unknown>) {
  return {
    file: typeof argv.file === 'string' ? argv.file : undefined,
    data: typeof argv.data === 'string' ? argv.data : undefined,
    stdin: argv.stdin === true,
    watch: argv.watch === true,
    json: argv.json === true,
    toon: argv.toon === true,
    outputFormat:
      typeof argv.outputFormat === 'string'
        ? argv.outputFormat
        : typeof argv['output-format'] === 'string'
          ? argv['output-format']
          : undefined,
  };
}

export async function runCli(
  rawArgv: readonly string[] = process.argv.slice(2),
  deps: CliDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? (msg => console.log(msg));
  const stderr = deps.stderr ?? (msg => console.error(msg));
  const exit = deps.exit ?? (code => process.exit(code));
  const daemonDir = deps.daemonDir ?? computeClientInfo().daemonDir;
  let exitCode = 0;

  const tools = deps.tools ?? loadStaticToolsManifest()?.tools ?? [];
  const toolSpecByCommand = new Map<string, CommandArgSpec>();
  for (const tool of tools) {
    if (RESERVED_COMMANDS.has(tool.name)) continue;
    const spec = getToolArgSpec(tool.name, tool.argSpecs);
    const names = [
      tool.name,
      tool.name.replaceAll('_', '-'),
      ...(tool.aliases ?? []),
      ...(tool.aliases ?? []).map(a => a.replaceAll('_', '-')),
    ];
    for (const name of names) {
      if (!RESERVED_COMMANDS.has(name) && !toolSpecByCommand.has(name)) {
        toolSpecByCommand.set(name, spec);
      }
    }
  }

  const {argv: cliArgs, restore} = preprocessArgv(rawArgv, name =>
    toolSpecByCommand.get(name),
  );
  const config = loadCliConfig();
  const makeConnect = (session: string, spawnFlags: string[] = []) =>
    deps.connect
      ? () => deps.connect!(session, spawnFlags)
      : () => defaultConnect(session, spawnFlags, daemonDir);

  const reportError = (err: unknown): void => {
    exitCode = 1;
    if (err instanceof CliError) {
      stderr(`Error [${err.code}]: ${err.message}`);
      if (err.suggestions?.length) {
        for (const s of err.suggestions) stderr(`  Hint: ${s}`);
      }
    } else {
      stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    exit(1);
  };

  const y = yargs(cliArgs)
    .scriptName('browsercli')
    .usage('browsercli [-s <session>] <command> [...args] [--flags]')
    .usage("Run 'browsercli <command> --help' for help on a specific command.")
    .option('session', {
      alias: 's',
      type: 'string',
      describe: '会话名（默认 default，可用 BROWSERCLI_SESSION 覆盖）',
      default: resolveSessionName(),
      coerce: (val: string) => {
        const resolved = resolveSessionName(val);
        assertValidSessionName(resolved);
        return resolved;
      },
    })
    .parserConfiguration({
      'parse-numbers': false,
      'parse-positional-numbers': false,
    })
    .demandCommand(1, '请指定子命令。运行 browsercli --help 查看用法。')
    .version(CLI_VERSION)
    .help(true)
    .wrap(120)
    .exitProcess(false)
    .fail((msg, err) => {
      if (err) {
        reportError(err);
      } else if (msg) {
        exitCode = 1;
        stderr(`Error: ${msg}`);
        exit(1);
      }
    });

  // 1. start
  y.command(
    'start',
    '启动或重启 daemon 会话（对齐 chrome-devtools start）',
    b => b.options(START_YARGS_OPTIONS).strict(),
    async argv => {
      try {
        const session = String(argv.session);
        const existing = await loadSession(daemonDir, session);
        let restarted = false;
        if (existing) {
          const conn = await probeSession(existing);
          if (conn) {
            conn.close();
            restarted = true;
            await stopSession(existing, daemonDir);
          }
        }
        const spawnFlags = serializeStartFlags(argv, config);
        const cfg = await ensureDaemon({session, spawnFlags, daemonDir});

        let browser: BrowserConnectionStatus | undefined;
        if (hasExplicitBrowserFlags(argv)) {
          const body = buildBrowserConnectOptions(argv, config);
          if (Object.keys(body).length > 0) {
            browser = await connectBrowserWithRetry(
              cfg.socketPath,
              body as Record<string, unknown>,
            );
          }
        }

        const payload = {
          action: restarted ? 'restart' : 'start',
          session: cfg.name,
          pid: cfg.pid,
          consolePort: cfg.consolePort ?? null,
          socketPath: cfg.socketPath,
          ...(browser ? {browser} : {}),
        };
        if (argv.json) {
          stdout(JSON.stringify(payload, null, 2));
        } else {
          stdout(
            `browsercli daemon ${payload.action === 'restart' ? 'restarted' : 'started'}: session=${cfg.name} pid=${cfg.pid} socket=${cfg.socketPath}`,
          );
          if (browser) {
            stdout(
              `browser: connected=${browser.connected} mode=${browser.mode} pages=${browser.pages}`,
            );
          }
        }
      } catch (err) {
        reportError(err);
      }
    },
  );

  // 2. stop
  y.command(
    'stop',
    '停止 daemon 会话，支持 --all 停止全部',
    b =>
      b
        .option('all', {type: 'boolean', describe: '强杀所有运行中的 daemon'})
        .option('json', {type: 'boolean', describe: '以 JSON 格式输出'})
        .strict(),
    async argv => {
      try {
        const session = String(argv.session);
        if (argv.all) {
          const killed = await killAllDaemons();
          for (const cfg of await listSessions(daemonDir)) {
            await deleteSession(daemonDir, cfg.name);
          }
          const files = await fs.promises.readdir(daemonDir).catch(() => []);
          for (const f of files) {
            if (f.endsWith('.spawn.lock')) {
              await fs.promises
                .unlink(path.join(daemonDir, f))
                .catch(() => undefined);
            }
          }
          stdout(
            argv.json
              ? JSON.stringify(
                  {action: 'stop-all', stopped: true, killed},
                  null,
                  2,
                )
              : `已停止全部 daemon 会话 (killed=${killed.length})`,
          );
          return;
        }

        const cfg = await loadSession(daemonDir, session);
        if (!cfg) {
          stdout(
            argv.json
              ? JSON.stringify(
                  {session, stopped: false, message: `会话 ${session} 未运行`},
                  null,
                  2,
                )
              : `会话 ${session} 未运行`,
          );
          return;
        }
        await stopSession(cfg, daemonDir);
        stdout(
          argv.json
            ? JSON.stringify({session, stopped: true}, null, 2)
            : `已停止会话 ${session}`,
        );
      } catch (err) {
        reportError(err);
      }
    },
  );

  // 3. status
  y.command(
    'status',
    '查看 daemon 会话与浏览器运行状态',
    b =>
      b
        .option('json', {type: 'boolean', describe: '以 JSON 格式输出'})
        .strict(),
    async argv => {
      try {
        const session = String(argv.session);
        const rows = await collectSessionRows(daemonDir);
        const current = rows.find(
          r => r.session === session && r.status === 'open',
        );
        let browser: BrowserConnectionStatus | undefined;
        if (current?.socketPath) {
          try {
            const conn = await DaemonConnection.connect(
              current.socketPath,
              1000,
            );
            try {
              browser = await conn.request<BrowserConnectionStatus>(
                'browser.status',
                undefined,
                1000,
              );
            } finally {
              conn.close();
            }
          } catch {
            // ignore probe error
          }
        }
        const warnings = rows
          .filter(
            r => r.status === 'open' && r.version && r.version !== CLI_VERSION,
          )
          .map(
            r =>
              `Warning: Daemon version (${r.version}) != CLI (${CLI_VERSION}) for session '${r.session}'. Run 'browsercli -s=${r.session} start'.`,
          );

        if (argv.json) {
          stdout(
            JSON.stringify(
              {
                online: Boolean(current),
                session,
                current: current ?? null,
                browser: browser ?? null,
                totalOnline: rows.filter(r => r.status === 'open').length,
                sessions: rows,
                ...(warnings.length ? {warnings} : {}),
              },
              null,
              2,
            ),
          );
          return;
        }

        if (current) {
          stdout(
            `session=${session} status=running pid=${current.pid} socket=${current.socketPath ?? '-'} version=${current.version ?? '-'}`,
          );
          if (browser) {
            stdout(
              `browser: ${browser.connected ? `connected (${browser.mode}, ${browser.pages} pages)` : 'disconnected'}`,
            );
          }
        } else {
          stdout(
            `session=${session} status=stopped (run 'browsercli start' to launch)`,
          );
        }
        for (const w of warnings) console.warn(w);
      } catch (err) {
        reportError(err);
      }
    },
  );

  // 4. config
  y.command(
    'config [action] [arg]',
    '查看/设置/初始化全局配置',
    b =>
      b
        .positional('action', {type: 'string'})
        .positional('arg', {type: 'string'})
        .option('init', {type: 'boolean', describe: '初始化配置文件'})
        .option('set', {type: 'string', describe: '设置配置项 key=value'})
        .option('get', {type: 'string', describe: '读取配置项'})
        .option('unset', {type: 'string', describe: '删除配置项'})
        .option('list', {
          type: 'boolean',
          describe: '列出配置文件路径与环境变量',
        })
        .strict(),
    argv => {
      try {
        const res = runConfig({
          init: Boolean(argv.init),
          set: argv.set as string | undefined,
          get: argv.get as string | undefined,
          unset: argv.unset as string | undefined,
          list: Boolean(argv.list),
          action: argv.action as string | undefined,
          arg: argv.arg as string | undefined,
        });
        stdout(JSON.stringify(res, null, 2));
      } catch (err) {
        reportError(err);
      }
    },
  );

  // 5. 已废弃旧命令迁移提示（隐藏，不污染 --help）
  for (const [deprecated, replacement] of Object.entries(DEPRECATED_HINTS)) {
    y.command(
      deprecated,
      false,
      b => b.strict(false),
      () => {
        reportError(
          new CliError(
            `命令 '${deprecated}' 已废弃，请改用 '${replacement}'。`,
            'COMMAND_DEPRECATED',
            [`请使用替代命令: ${replacement}`],
          ),
        );
      },
    );
  }

  // 7. 动态注册全部静态工具为一级命令（对齐 chrome-devtools.ts 位置参数 + 可选 flags）
  const registered = new Set<string>(RESERVED_COMMANDS);
  for (const tool of tools) {
    if (registered.has(tool.name)) continue;
    registered.add(tool.name);

    const aliases: string[] = [];
    const candidates = [
      tool.name.replaceAll('_', '-'),
      ...(tool.aliases ?? []),
      ...(tool.aliases ?? []).map(a => a.replaceAll('_', '-')),
    ];
    for (const alias of candidates) {
      if (!registered.has(alias)) {
        registered.add(alias);
        aliases.push(alias);
      }
    }

    const {slots, positionalSuffix, usage} = buildToolCommand(
      tool.name,
      tool.argSpecs,
    );
    const commandPatterns = buildCommandPatterns(
      [tool.name, ...aliases],
      positionalSuffix,
    );
    const directPositionalArgNames = new Set(
      slots
        .filter(s => !isSyntheticPositionalSlot(s))
        .map(s => (s.target.kind === 'arg' ? s.target.argName : s.name)),
    );
    const syntheticSlotNames = new Set(
      slots.filter(isSyntheticPositionalSlot).map(s => s.name),
    );

    y.command(
      commandPatterns,
      tool.description,
      b => {
        b.usage(usage);
        addToolControlOptions(b);
        for (const slot of slots) {
          const describe =
            slot.defaultValue !== undefined
              ? `${slot.description} (default: ${JSON.stringify(slot.defaultValue)})`
              : slot.description;
          const posOpt: PositionalOptions = {
            describe,
            type: slot.type,
          };
          if (slot.variadic) {
            posOpt.array = true;
          }
          if (slot.enum?.length) {
            posOpt.choices = slot.enum;
          }
          b.positional(slot.name, posOpt);
        }
        for (const [argName, spec] of Object.entries(tool.argSpecs ?? {})) {
          if (directPositionalArgNames.has(argName)) continue;
          const opt: Options = {
            describe: spec.description,
            type:
              spec.type === 'boolean'
                ? 'boolean'
                : spec.type === 'number'
                  ? 'number'
                  : spec.type === 'string[]'
                    ? 'array'
                    : 'string',
          };
          if (spec.defaultValue !== undefined) {
            opt.defaultDescription = JSON.stringify(spec.defaultValue);
          }
          if (spec.enum?.length) {
            opt.choices = spec.enum;
          }
          b.option(argName, opt);
        }
        return b;
      },
      async argv => {
        try {
          const session = String(argv.session);
          const syntheticPositionals: string[] = [];
          for (const slot of slots) {
            if (!isSyntheticPositionalSlot(slot)) continue;
            const rawVal = restore(argv[slot.name]);
            if (rawVal === undefined) continue;
            if (Array.isArray(rawVal)) {
              for (const item of rawVal) {
                syntheticPositionals.push(String(item));
              }
            } else {
              syntheticPositionals.push(String(rawVal));
            }
          }
          const trailingPositionals = (argv._.slice(1) as unknown[]).map(v =>
            String(restore(v)),
          );
          const positionals = [...syntheticPositionals, ...trailingPositionals];
          const restoredFlags: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(argv)) {
            if (syntheticSlotNames.has(k)) continue;
            restoredFlags[k] = restore(v);
          }
          const res = await invokeTool({
            toolName: tool.name,
            rawFlags: restoredFlags,
            positionals,
            controlFlags: extractControlFlags(restoredFlags),
            defaultOutputFormat: config.outputFormat,
            connect: makeConnect(session, serializeStartFlags({}, config)),
          });
          stdout(res.rendered);
        } catch (err) {
          reportError(err);
        }
      },
    );
  }

  // 8. 兜底：未注册为一级命令的工具名（daemon 动态注册的工具 / 拼写错误）交给 invokeTool
  y.command(
    '*',
    false,
    b => b.strict(false),
    async argv => {
      try {
        const [toolName, ...positionals] = argv._.map(v => String(restore(v)));
        if (!toolName) {
          exitCode = 1;
          stderr('Error: 请指定子命令。运行 browsercli --help 查看用法。');
          exit(1);
          return;
        }
        const restoredFlags: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(argv)) {
          restoredFlags[k] = restore(v);
        }
        const res = await invokeTool({
          toolName,
          rawFlags: restoredFlags,
          positionals,
          controlFlags: extractControlFlags(restoredFlags),
          defaultOutputFormat: config.outputFormat,
          connect: makeConnect(
            String(argv.session),
            serializeStartFlags({}, config),
          ),
        });
        stdout(res.rendered);
      } catch (err) {
        reportError(err);
      }
    },
  );

  await y.parseAsync();
  return exitCode;
}
