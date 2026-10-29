/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 浏览器配置的不变量 —— ego 模式的两条「不许静默忽略」规则。
 *
 * 放在这个**零依赖**模块里，而不是 `servicesConfig` 里：
 * - 配置合并层（`servicesConfig.getBrowserManagerConfig`）、IPC 请求层
 *   （`worker/browserRequests`）和 CLI（`cli/commands/browser`）都要用同一个
 *   判定和同一句提示，三处各写一份必然漂移；
 * - CLI 不能 import `servicesConfig`：那会把 zod / patchright 整张依赖图拉进
 *   `browsercli` 进程（冷启动 ~0.1s → ~0.7s），只为判一个布尔。
 */

/**
 * `keepPage` 脱离 `ego` 时不会被任何代码读取：保留策略只在
 * `BrowserManager.connectEgoBrowser()` → `EgoBridgeManager.start({keepPage})`
 * 这一条 ego 分支里生效，别的分支（本地启动 / 远程附连）看都不看它。
 */
export function isKeepPageWithoutEgo(config: {
  ego?: boolean | null;
  keepPage?: boolean | null;
}): boolean {
  return config.keepPage === true && config.ego !== true;
}

/**
 * ego 模式既不本地启动浏览器、也不附连指定端点（`ensureBrowser()` 直接走 ego
 * 分支），所以同时给出的目标参数全是死配置 —— 显式写了却不用，与 `keepPage`
 * 同类。
 */
export function isEgoWithTarget(config: {
  ego?: boolean | null;
  browserURL?: unknown;
  wsEndpoint?: unknown;
  channel?: unknown;
  executablePath?: unknown;
}): boolean {
  return (
    config.ego === true &&
    (config.browserURL !== undefined ||
      config.wsEndpoint !== undefined ||
      config.channel !== undefined ||
      config.executablePath !== undefined)
  );
}

/**
 * ego 模式下**只在本地启动路径读取**的 flag。
 *
 * `ensureBrowser()` 在 ego 分支直接走 `connectToRemoteBrowser()`，`launchBrowser()`
 * 一行都不会执行，所以这些 flag 被接受却完全没人读 —— 与 `keepPage` 脱离 `ego`
 * 是同一类「静默忽略」，区别只是它们人多。`--js-stealth` 也算在内：远程路径只看
 * `config.useStealthScripts`，而 CLI 的 `--js-stealth` 从不写它。
 */
export function isEgoWithLaunchOnly(config: {
  ego?: boolean | null;
  cloak?: unknown;
  headless?: unknown;
  userDataDir?: unknown;
  isolated?: unknown;
  minimalStealth?: unknown;
  fullStealthArgs?: unknown;
  jsStealth?: unknown;
  acceptInsecureCerts?: unknown;
}): boolean {
  if (config.ego !== true) return false;
  return (
    config.cloak === true ||
    config.headless !== undefined ||
    config.userDataDir !== undefined ||
    config.isolated === true ||
    config.minimalStealth === true ||
    config.fullStealthArgs === true ||
    config.jsStealth === true ||
    config.acceptInsecureCerts !== undefined
  );
}

/** 逐个点名，因为「你写的那几个 flag 在 ego 下不生效」比一句「互斥」有用得多。 */
export const EGO_LAUNCH_ONLY_FLAGS_MESSAGE =
  'ego 模式不启动本地浏览器，以下参数在 ego 下不生效：--cloak / --headless / --user-data-dir / --isolated / --minimal-stealth / --full-stealth-args / --js-stealth / --accept-insecure-certs';

/** 同时点出两个 key（CLI flag、环境变量、配置键），用户才知道该改哪一个。 */
export const KEEP_PAGE_WITHOUT_EGO_MESSAGE =
  'keepPage 需要 ego：--keep-page / BROWSER_KEEP_PAGE 只在 ego 模式（--ego / BROWSER_EGO）下生效';

/** ego 与四个连接目标互斥（help 里已经这么声明，这里把它变成真的）。 */
export const EGO_TARGET_CONFLICT_MESSAGE =
  'ego 与连接目标互斥：--ego / BROWSER_EGO 不能和 --browser-url / --ws-endpoint / --channel / --executable-path 同时指定（ego 模式不启动本地浏览器，也不附连指定端点）';

/**
 * 生效配置自相矛盾（目前只有 `keepPage` 没有 `ego`）。
 *
 * `code` 让 IPC 层把它当 VALIDATION 上报（`daemonServer.toErrorCode` 直接读
 * `error.code`），而不是笼统的 INTERNAL。
 */
export class BrowserConfigInvariantError extends Error {
  readonly code = 'VALIDATION';

  constructor(message: string) {
    super(message);
    this.name = 'BrowserConfigInvariantError';
  }
}

/**
 * 对**生效配置**断言不变量：出口处只调这一个函数，别处不再各写一遍判定。
 * 零依赖，CLI 与 `worker/browserRequests` 都能安全 import。
 */
export function assertBrowserConfigInvariants(config: {
  ego?: boolean | null;
  keepPage?: boolean | null;
}): void {
  // Only `keepPage` is checked HERE. The launch-only flags deliberately are not:
  // this function also runs on the raw env layer, where `headless` and friends
  // carry their defaults, so checking them rejected every plain
  // `BROWSER_EGO=true` (measured — the attempt was reverted).
  //
  // Known gaps, stated rather than implied closed: a launch-only key written in
  // `config.json` next to `ego: true`, `BROWSER_CLOAK=true` alongside `--ego`, and
  // `BROWSER_EGO=true` with `{cloak:true}` in an IPC body (that check reads the
  // body, not the env) are all accepted and then ignored. Closing them needs the
  // check somewhere that sees one already-merged, already-defaulted object.
  if (isKeepPageWithoutEgo(config)) {
    throw new BrowserConfigInvariantError(KEEP_PAGE_WITHOUT_EGO_MESSAGE);
  }
}

/** 环境变量布尔真值词表 —— 唯一来源，`resolver.getEnvBoolean` 也用这一份。 */
export const ENV_TRUE_VALUES: readonly string[] = ['true', '1', 'yes', 'on'];
/** 环境变量布尔假值词表 —— 唯一来源。 */
export const ENV_FALSE_VALUES: readonly string[] = ['false', '0', 'no', 'off'];

/**
 * 解析布尔环境变量值：`true/1/yes/on` → true，`false/0/no/off` → false，其余
 * （含 undefined、空串、无法识别）→ undefined。
 *
 * `config/resolver.ts::getEnvBoolean` 只是在本函数之上加一层 `?? default`，
 * 词表因此只有一份、不会漂移。单列在此是为了让 CLI 能读这两个环境变量而不
 * 引入 resolver 的依赖图。
 */
export function parseEnvBoolean(
  value: string | undefined,
): boolean | undefined {
  const normalized = value?.toLowerCase().trim();
  if (normalized === undefined || normalized === '') return undefined;
  if (ENV_TRUE_VALUES.includes(normalized)) return true;
  if (ENV_FALSE_VALUES.includes(normalized)) return false;
  return undefined;
}

/** 读布尔环境变量：`parseEnvBoolean(process.env[key])` 的便捷形式。 */
export function getEnvFlag(key: string): boolean | undefined {
  return parseEnvBoolean(process.env[key]);
}

/**
 * 给生效配置的不变量错误补上「该改哪儿」：配置文件路径 + 环境变量名。
 *
 * `KEEP_PAGE_WITHOUT_EGO_MESSAGE` 只点出两个 key，不说是哪份文件 —— daemon 启动
 * 时它会让进程直接退出，用户只看到 "启动失败" 却不知道该编辑什么。路径由调用方
 * 传入（本模块是零依赖的，不能 import resolver 去取 `getUserConfigPath()`）。
 */
export function withConfigFileHint(
  error: BrowserConfigInvariantError,
  paths: {configFile: string; runtimeFile: string},
): BrowserConfigInvariantError {
  return new BrowserConfigInvariantError(
    `${error.message}\n请修改配置文件 ${paths.configFile} 或 ${paths.runtimeFile}` +
      `（删掉 browser.keepPage，或补上 "ego": true）；` +
      '由环境变量引入时改 BROWSER_KEEP_PAGE / BROWSER_EGO。',
  );
}
