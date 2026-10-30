/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {AxiError} from 'axi-sdk-js';
import type {AxiCliCommand} from 'axi-sdk-js';

/**
 * ego 的两条「不许静默忽略」不变量与提示语来自配置层的零依赖模块
 * （`browserInvariants.ts`）：配置合并层与 IPC 请求层用的是同一份判定，避免
 * 三处各写一套词表后漂移。该模块不 import 任何东西，不会把 zod / patchright
 * 拉进 CLI 进程。
 */
import {
  EGO_TARGET_CONFLICT_MESSAGE,
  getEnvFlag,
  EGO_LAUNCH_ONLY_FLAGS_MESSAGE,
  isEgoWithLaunchOnly,
  isEgoWithTarget,
  isKeepPageWithoutEgo,
  isProfileWithoutEgo,
  KEEP_PAGE_WITHOUT_EGO_MESSAGE,
  PROFILE_WITHOUT_EGO_MESSAGE,
} from '../../config/browserInvariants.js';
import {queryEgoSpaces} from '../../modules/browser/ego/ego-spaces.js';
import {parseArgs} from '../args-parser.js';
import {toAxiError} from '../errors.js';
import {successOutput, tableOutput} from '../output.js';
import type {WorkerContext} from '../types.js';
import type {
  BrowserConnectOptions,
  BrowserConnectionStatus,
  BrowserDisconnectOptions,
} from '../types.js';

const CONNECT_FLAGS = new Set([
  'accept-insecure-certs',
  'browser-url',
  'channel',
  'cloak',
  'ego',
  'executable-path',
  'force',
  'full-stealth-args',
  'headless',
  'isolated',
  'js-stealth',
  'json',
  'keep-page',
  'minimal-stealth',
  'profile',
  'user-data-dir',
  'viewport',
  'ws-endpoint',
  'ws-headers',
]);
const READ_FLAGS = new Set(['json']);
const DISCONNECT_FLAGS = new Set(['force', 'json']);
const CHANNELS = new Set([
  'stable',
  'beta',
  'dev',
  'canary',
  'chrome',
  'chrome-beta',
  'chrome-dev',
  'chrome-canary',
  'chromium',
  'bidi-chromium',
  'bidi-chrome',
  'bidi-chrome-beta',
  'bidi-chrome-dev',
  'bidi-chrome-canary',
  'firefox',
  'moz-firefox',
]);

function invalid(message: string): never {
  throw new AxiError(message, 'VALIDATION_ERROR', [
    '用法：browsercli browser connect|disconnect|status [options]',
  ]);
}

function assertFlags(
  flags: Record<string, string | boolean>,
  allowed: Set<string>,
): void {
  const unknown = Object.keys(flags).find(key => !allowed.has(key));
  if (unknown) invalid(`未知参数：--${unknown}`);
}

function stringFlag(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  if (!(key in flags)) return undefined;
  const value = flags[key];
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`--${key} 缺少值`);
  }
  return value;
}

function booleanFlag(
  flags: Record<string, string | boolean>,
  key: string,
): boolean | undefined {
  if (!(key in flags)) return undefined;
  const value = flags[key];
  if (typeof value === 'boolean') return value;
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return invalid(`--${key} 必须是 true 或 false`);
}

function urlFlag(
  flags: Record<string, string | boolean>,
  key: string,
  protocols: string[],
): string | undefined {
  const value = stringFlag(flags, key);
  if (value === undefined) return undefined;
  let normalized = value;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    normalized = protocols.includes('http:') ? `http://${value}` : value;
  }
  let protocol: string;
  try {
    protocol = new URL(normalized).protocol;
  } catch {
    return invalid(`--${key} 不是合法 URL`);
  }
  if (!protocols.includes(protocol)) {
    return invalid(`--${key} 必须使用 ${protocols.join(' 或 ')}`);
  }
  return normalized;
}

function headersFlag(
  flags: Record<string, string | boolean>,
): Record<string, string> | undefined {
  const raw = stringFlag(flags, 'ws-headers');
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid('--ws-headers 必须是合法 JSON');
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.values(value).some(item => typeof item !== 'string')
  ) {
    return invalid('--ws-headers 必须是字符串键值对象');
  }
  return value as Record<string, string>;
}

function viewportFlag(
  flags: Record<string, string | boolean>,
): {width: number; height: number} | undefined {
  const raw = stringFlag(flags, 'viewport');
  if (raw === undefined) return undefined;
  const match = /^(\d+)x(\d+)$/.exec(raw);
  if (!match) return invalid('--viewport 格式必须为 宽x高');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1 || height < 1) return invalid('--viewport 宽高必须大于 0');
  return {width, height};
}

function connectOptions(
  flags: Record<string, string | boolean>,
): BrowserConnectOptions {
  assertFlags(flags, CONNECT_FLAGS);
  const browserURL = urlFlag(flags, 'browser-url', ['http:', 'https:']);
  const wsEndpoint = urlFlag(flags, 'ws-endpoint', ['ws:', 'wss:']);
  const channel = stringFlag(flags, 'channel');
  const executablePath = stringFlag(flags, 'executable-path');
  const remote = browserURL !== undefined || wsEndpoint !== undefined;
  const local = channel !== undefined || executablePath !== undefined;
  if (
    (browserURL !== undefined && wsEndpoint !== undefined) ||
    (channel !== undefined && executablePath !== undefined) ||
    (remote && local)
  ) {
    invalid('连接目标参数互斥');
  }
  if (channel !== undefined && !CHANNELS.has(channel)) {
    invalid(`不支持的浏览器 channel：${channel}`);
  }

  const options: BrowserConnectOptions = {};
  if (browserURL !== undefined) options.browserURL = browserURL;
  if (wsEndpoint !== undefined) options.wsEndpoint = wsEndpoint;
  if (channel !== undefined) options.channel = channel;
  if (executablePath !== undefined) options.executablePath = executablePath;

  const wsHeaders = headersFlag(flags);
  const viewport = viewportFlag(flags);
  const userDataDir = stringFlag(flags, 'user-data-dir');
  if (wsHeaders !== undefined) options.wsHeaders = wsHeaders;
  if (viewport !== undefined) options.viewport = viewport;
  if (userDataDir !== undefined) options.userDataDir = userDataDir;

  const booleans = {
    acceptInsecureCerts: booleanFlag(flags, 'accept-insecure-certs'),
    cloak: booleanFlag(flags, 'cloak'),
    ego: booleanFlag(flags, 'ego'),
    force: booleanFlag(flags, 'force'),
    fullStealthArgs: booleanFlag(flags, 'full-stealth-args'),
    headless: booleanFlag(flags, 'headless'),
    isolated: booleanFlag(flags, 'isolated'),
    jsStealth: booleanFlag(flags, 'js-stealth'),
    keepPage: booleanFlag(flags, 'keep-page'),
    minimalStealth: booleanFlag(flags, 'minimal-stealth'),
  };
  // ego lite 是默认浏览器来源：既不显式给出 `--ego`，也没有指定任何其它连接
  // 目标与浏览器来源开关时，`browsercli browser connect` 就连 ego。
  //
  // 只在「完全没得选」时成立 —— `BROWSER_EGO=false` 这类环境变量、显式
  // `--ego=false`、任何一个目标参数（`--browser-url` / `--ws-endpoint` /
  // `--channel` / `--executable-path`），或 `--cloak` 都算用户表达了别的意图，
  // 此时不注入默认值。环境变量必须参与判断：否则 `BROWSER_EGO=false` 会被这个
  // 默认值反手盖成 true，用户意图被静默翻转。这样也不会触发 `isEgoWithTarget`
  // 那条互斥：默认值只在那些参数与环境变量全缺时出现。
  //
  // 无参 connect 在未安装 ego 的机器上会报错（`ego lite is not installed: ...`
  // 并给出 `EGO_BROWSER_CLI`），而不是静默降级成本地 Chromium —— 静默回退会
  // 让"到底连上了哪个浏览器"变成隐式，而这两者的登录态与反检测面完全不同。
  if (
    booleans.ego === undefined &&
    getEnvFlag('BROWSER_EGO') === undefined &&
    browserURL === undefined &&
    wsEndpoint === undefined &&
    channel === undefined &&
    executablePath === undefined &&
    booleans.cloak !== true
  ) {
    booleans.ego = true;
  }
  // ego 的两条不变量在这里先挡一次，用的是**生效值**（flag 优先，其次同名
  // 环境变量），因为它们最终都会进入同一份配置：`--keep-page` 或
  // `BROWSER_KEEP_PAGE` 在没有 ego 时不会被任何分支读取，`--ego` 与四个目标
  // 参数则是 help 里已经声明的互斥关系。终端路径在 spawn daemon 之前就报错，
  // 用户不会看到「连接成功但其实没生效」。合并层与 IPC 请求层另有同一守卫。
  const effectiveEgo = booleans.ego ?? getEnvFlag('BROWSER_EGO');
  if (
    isKeepPageWithoutEgo({
      ego: effectiveEgo,
      keepPage: booleans.keepPage ?? getEnvFlag('BROWSER_KEEP_PAGE'),
    })
  ) {
    invalid(KEEP_PAGE_WITHOUT_EGO_MESSAGE);
  }
  // `--profile` names an ego task-space identity; without ego nothing reads it,
  // so accepting it would be the same silent ignore as `--keep-page`.
  const profile = stringFlag(flags, 'profile');
  if (
    isProfileWithoutEgo({
      ego: effectiveEgo,
      egoProfile: profile ?? process.env.BROWSER_EGO_PROFILE,
    })
  ) {
    invalid(PROFILE_WITHOUT_EGO_MESSAGE);
  }
  if (profile !== undefined) options.egoProfile = profile;
  if (
    isEgoWithTarget({
      ego: effectiveEgo,
      browserURL,
      wsEndpoint,
      channel,
      executablePath,
    })
  ) {
    invalid(EGO_TARGET_CONFLICT_MESSAGE);
  }
  // These eight flags are read only by `launchBrowser()`, which ego mode never
  // reaches, so accepting them would be the same silent ignore as `keepPage`
  // without `ego`. `booleans` is keyed by CONFIG names (camelCase) while the
  // flags are kebab-case — reading one with the other's spelling yields
  // `undefined` and disables the check without failing, so each entry below is
  // spelled explicitly and a test pins every one of them.
  const launchOnlyFlags = {
    cloak: booleans.cloak,
    headless: booleans.headless,
    userDataDir: stringFlag(flags, 'user-data-dir'),
    isolated: booleans.isolated,
    minimalStealth: booleans.minimalStealth,
    fullStealthArgs: booleans.fullStealthArgs,
    jsStealth: booleans.jsStealth,
    acceptInsecureCerts: booleans.acceptInsecureCerts,
  };
  if (isEgoWithLaunchOnly({ego: effectiveEgo, ...launchOnlyFlags})) {
    invalid(EGO_LAUNCH_ONLY_FLAGS_MESSAGE);
  }
  for (const [key, value] of Object.entries(booleans)) {
    if (value !== undefined) {
      (options as Record<string, unknown>)[key] = value;
    }
  }
  return options;
}

const SPACE_FLAGS = new Set(['json']);

/**
 * `browser space list` — show ego's task spaces and profiles.
 *
 * Answers the question `--profile` raises ("which id do I pass?") without
 * requiring the user to read ego's UI. Runs locally against ego rather than
 * through the daemon, because it must also work when no browser is connected.
 */
async function runSpaceCommand(
  rest: string[],
  flags: Record<string, string | boolean>,
  ctx: WorkerContext | undefined,
) {
  const sub = rest[0];
  if (rest.length !== 1 || sub !== 'list') {
    invalid('space 的子命令只有 list（如 browsercli browser space list）');
  }
  assertFlags(flags, SPACE_FLAGS);
  const json = booleanFlag(flags, 'json') ?? false;

  let snapshot;
  try {
    snapshot = await queryEgoSpaces();
  } catch (error) {
    throw toAxiError(error, 'BROWSER_ERROR');
  }

  const spaces = snapshot.spaces;
  const profiles = snapshot.profiles;
  const currentProfile = profiles.find(profile => profile.isDefault);

  const result = {
    command: 'browser',
    action: 'space',
    subaction: 'list',
    spaces: spaces.map(space => ({
      id: space.id,
      name: space.name ?? '',
      ownership: space.ownership ?? 'unknown',
      createdBy: space.createdBy ?? 'unknown',
      profileId: space.profileId ?? '',
      profileName: space.profileName ?? '',
    })),
    profiles: profiles.map(profile => ({
      id: profile.id,
      name: profile.name,
      isDefault: profile.isDefault,
    })),
    ...(currentProfile === undefined
      ? {}
      : {defaultProfileId: currentProfile.id}),
  };
  if (json) return successOutput(result, ctx?.session);

  // Human table: the profile columns are what `--profile` consumes, so they are
  // shown, and the default profile is marked where it appears.
  const rows = spaces.map(space => [
    String(space.id),
    space.name === '' ? '(未命名)' : space.name,
    space.ownership ?? 'unknown',
    space.profileId === undefined || space.profileId === ''
      ? '(未知)'
      : `${space.profileId}${space.profileName ? ` / ${space.profileName}` : ''}`,
  ]);
  const profileRows = profiles.map(profile => [
    profile.id,
    profile.name,
    profile.isDefault ? '是（--profile 省略时使用）' : '',
  ]);

  return {
    ...tableOutput(['ID', '名称', '归属', 'Profile'], rows),
    profiles: profileRows,
    profileHeaders: ['Profile ID', '名称', '默认'],
    ...(currentProfile === undefined
      ? {}
      : {
          hint: `新建任务空间默认使用 ${currentProfile.id}；用 --profile <id> 指定别的`,
        }),
    ...result,
  };
}

function renderBrowserStatus(
  action: 'connect' | 'disconnect' | 'status',
  state: BrowserConnectionStatus,
  json: boolean,
  session?: string,
) {
  const result = {command: 'browser', action, ...state};
  if (json) return successOutput(result, session);
  return {
    ...tableOutput(
      ['Property', 'Value'],
      [
        ['Connected', String(state.connected)],
        ['Mode', state.mode],
        ['Pages', String(state.pages)],
      ],
    ),
    ...(session !== undefined ? {session} : {}),
    ...result,
  };
}

export const browserCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const action = parsed.positionals[0];
  // `space list` is a read-only question about ego's own state (which task
  // spaces and profiles exist), not an operation on a browser connection, so it
  // is dispatched before anything touches the daemon.
  if (action === 'space') {
    return runSpaceCommand(parsed.positionals.slice(1), parsed.flags, ctx);
  }
  if (
    parsed.positionals.length !== 1 ||
    !['connect', 'disconnect', 'status'].includes(action)
  ) {
    invalid(
      '浏览器动作必须是 connect、disconnect、status 或 space（如 space list）',
    );
  }
  const typedAction = action as 'connect' | 'disconnect' | 'status';
  assertFlags(
    parsed.flags,
    typedAction === 'connect'
      ? CONNECT_FLAGS
      : typedAction === 'disconnect'
        ? DISCONNECT_FLAGS
        : READ_FLAGS,
  );
  const json = booleanFlag(parsed.flags, 'json') ?? false;
  const force =
    typedAction === 'disconnect'
      ? booleanFlag(parsed.flags, 'force')
      : undefined;
  // Parsed before connecting so an invalid flag combination (`--keep-page`
  // without `--ego`) is rejected locally instead of spawning a daemon first.
  const connectBody =
    typedAction === 'connect' ? connectOptions(parsed.flags) : undefined;
  const client = ctx ? await ctx.connect() : undefined;
  if (!client) throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');

  try {
    const state =
      typedAction === 'connect'
        ? await client.request<BrowserConnectionStatus>('browser.connect', {
            body: connectBody,
          })
        : typedAction === 'disconnect'
          ? await client.request<BrowserConnectionStatus>(
              'browser.disconnect',
              force === undefined
                ? {body: {}}
                : {body: {force} satisfies BrowserDisconnectOptions},
            )
          : await client.request<BrowserConnectionStatus>('browser.status');
    return renderBrowserStatus(typedAction, state, json, ctx?.session);
  } catch (error) {
    throw toAxiError(error, 'BROWSER_ERROR');
  } finally {
    client.close();
  }
};
