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
 * 读布尔环境变量：`true/1/yes/on` → true，`false/0/no/off` → false，其余（含
 * 未设置、空串、无法识别）→ undefined。
 *
 * 词表与 `config/resolver.ts::getEnvBoolean` 一致（后者只是再加一层 `?? default`）；
 * 单列在此是为了让 CLI 能读这两个环境变量而不引入 resolver 的依赖图。
 */
export function getEnvFlag(key: string): boolean | undefined {
  const value = process.env[key]?.toLowerCase().trim();
  if (value === undefined || value === '') return undefined;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return undefined;
}
