/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * browser 连接/断开请求体的解析与校验。
 * 供 daemon socket 服务（src/ipc/daemonServer.ts）复用，
 * 行为与下线前的 HTTP 路由版本一致。
 */

import {
  assertBrowserConfigInvariants,
  EGO_TARGET_CONFLICT_MESSAGE,
  getEnvFlag,
  EGO_LAUNCH_ONLY_FLAGS_MESSAGE,
  isEgoWithLaunchOnly,
  isEgoWithTarget,
  isKeepPageWithoutEgo,
  KEEP_PAGE_WITHOUT_EGO_MESSAGE,
} from '../config/browserInvariants.js';
import {getRuntimeConfigStore} from '../config/RuntimeConfigStore.js';
import {
  type BrowserConfig,
  BrowserConfigSchema,
  type GlobalConfig,
} from '../config/schema.js';
import {buildBrowserManagerConfig} from '../config/servicesConfig.js';
import type {BrowserManagerConfig} from '../modules/browser/index.js';

const BrowserConnectSchema = BrowserConfigSchema.pick({
  acceptInsecureCerts: true,
  browserURL: true,
  channel: true,
  cloak: true,
  ego: true,
  egoProfile: true,
  executablePath: true,
  fullStealthArgs: true,
  headless: true,
  isolated: true,
  jsStealth: true,
  keepPage: true,
  minimalStealth: true,
  userDataDir: true,
  viewport: true,
  wsEndpoint: true,
  wsHeaders: true,
}).strict();

export class BrowserConfigRequestError extends Error {
  constructor(
    readonly code: 'VALIDATION' | 'BROWSER_CONFIG_CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

function requireProtocol(
  key: string,
  value: string | undefined,
  protocols: string[],
): void {
  if (value === undefined) return;
  let protocol: string;
  try {
    let urlString = value;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
      urlString = protocols.includes('http:') ? `http://${value}` : value;
    }
    protocol = new URL(urlString).protocol;
  } catch {
    throw new BrowserConfigRequestError('VALIDATION', `${key} is not a URL`);
  }
  if (!protocols.includes(protocol)) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      `${key} must use ${protocols.join(' or ')}`,
    );
  }
}

export function parseBrowserConnectBody(body: unknown): BrowserConfig {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      'request body must be an object',
    );
  }
  const remote =
    Object.hasOwn(body, 'browserURL') || Object.hasOwn(body, 'wsEndpoint');
  const local =
    Object.hasOwn(body, 'channel') || Object.hasOwn(body, 'executablePath');
  if (
    (Object.hasOwn(body, 'browserURL') && Object.hasOwn(body, 'wsEndpoint')) ||
    (Object.hasOwn(body, 'channel') && Object.hasOwn(body, 'executablePath')) ||
    (remote && local)
  ) {
    throw new BrowserConfigRequestError(
      'BROWSER_CONFIG_CONFLICT',
      'browserURL, wsEndpoint, channel, and executablePath select mutually exclusive targets',
    );
  }

  const parsed = BrowserConnectSchema.safeParse(body);
  if (!parsed.success) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      parsed.error.issues
        .map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; '),
    );
  }
  requireProtocol('browserURL', parsed.data.browserURL, ['http:', 'https:']);
  requireProtocol('wsEndpoint', parsed.data.wsEndpoint, ['ws:', 'wss:']);
  if (parsed.data.executablePath === '') {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      'executablePath must not be empty',
    );
  }
  // ego 的两条不变量在请求层也要挡：IPC 不只从本 CLI 进来，面板/脚本都能直接
  // 发 `browser.connect`。合并层（`getBrowserManagerConfig`）与
  // `candidateBrowserConfig()` 另有同一守卫，三层都必要 —— 请求层给出的是
  // 「你这次请求写错了」，合并层给出的是「生效配置自相矛盾」。
  if (isEgoWithTarget(parsed.data)) {
    throw new BrowserConfigRequestError(
      'BROWSER_CONFIG_CONFLICT',
      EGO_TARGET_CONFLICT_MESSAGE,
    );
  }
  // Same class of silent ignore: flags only `launchBrowser()` reads must not be
  // accepted in ego mode, where that path never runs.
  if (isEgoWithLaunchOnly(parsed.data)) {
    throw new BrowserConfigRequestError(
      'BROWSER_CONFIG_CONFLICT',
      EGO_LAUNCH_ONLY_FLAGS_MESSAGE,
    );
  }
  // `keepPage` 的判定必须用**生效的 ego**，不能只看 body：daemon 继承
  // `BROWSER_EGO`，而 `browsercli browser connect --keep-page` 在 CLI 层已按
  // 环境变量放行，body 里只带 `{keepPage:true}`。只看 body 会把这条合法请求
  // 判成 VALIDATION，而 CLI 的 fake-daemon 测试看不出这个分歧。
  if (
    isKeepPageWithoutEgo({
      ego: parsed.data.ego ?? getEnvFlag('BROWSER_EGO'),
      keepPage: parsed.data.keepPage,
    })
  ) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      KEEP_PAGE_WITHOUT_EGO_MESSAGE,
    );
  }

  const patch: BrowserConfig = {...parsed.data};
  // 显式关掉 ego 时，把只服务于 ego 的两项一起清掉。store 的合并是
  // `{...oldBrowser, ...patch}`（浅合并），所以「键缺失」等于「保留上一次的值」：
  // `delete patch.keepPage` 挡不住上一次 `--ego --keep-page` 留下的
  // `keepPage: true`，合并结果会变成 `{ego:false, keepPage:true}` —— 断言一抛，
  // 用户就再也无法通过 IPC/CLI 退出 ego 模式（`--profile` 更糟：连
  // `--profile ""` 都被参数解析判成缺值），只能重启 daemon。
  // 因此与下面四个分支一致，赋 `undefined`：那是**显式覆盖成未设置**，与
  // 「键缺失 → 保留旧值」是两件事。
  if (parsed.data.ego === false) {
    patch.keepPage = undefined;
    patch.egoProfile = undefined;
  }
  if (
    patch.browserURL &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(patch.browserURL)
  ) {
    patch.browserURL = `http://${patch.browserURL}`;
  }

  const clearEgoAndOtherTargets = (
    keepKey: keyof BrowserConfig,
    keepValue: unknown,
  ) => {
    patch.browserURL = undefined;
    patch.wsEndpoint = undefined;
    patch.channel = undefined;
    patch.executablePath = undefined;
    patch.remoteDebuggingUrl = undefined;
    // 目标与 ego 互斥，而 store 是深合并的：上一次 `connect --ego` 留下的
    // `ego: true` 会活到这一次，让显式指定的目标撞进 `isEgoWithTarget`。
    // 用户这次既然点名了目标，就是放弃了 ego。
    patch.ego = undefined;
    // 连同只在 ego 下有含义的两项一起清，否则它们会活到后续合并结果里，
    // 下次无参 connect 又带着别人的 keepPage/profile 连上 ego。
    patch.keepPage = undefined;
    patch.egoProfile = undefined;
    (patch as Record<string, unknown>)[keepKey] = keepValue;
  };

  if (Object.hasOwn(parsed.data, 'browserURL')) {
    clearEgoAndOtherTargets('browserURL', patch.browserURL);
  } else if (Object.hasOwn(parsed.data, 'wsEndpoint')) {
    clearEgoAndOtherTargets('wsEndpoint', patch.wsEndpoint);
  } else if (Object.hasOwn(parsed.data, 'channel')) {
    clearEgoAndOtherTargets('channel', patch.channel);
  } else if (Object.hasOwn(parsed.data, 'executablePath')) {
    clearEgoAndOtherTargets('executablePath', patch.executablePath);
  }
  return patch;
}

export function parseBrowserDisconnectBody(
  body: Record<string, unknown>,
): boolean {
  const keys = Object.keys(body);
  if (keys.some(key => key !== 'force')) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      'request body only supports force',
    );
  }
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      'force must be a boolean',
    );
  }
  return body.force === true;
}

/**
 * 生效配置 = 合并层结果 + store 对 `browser` 的覆盖层（快照里 store 优先）。
 *
 * 不变量必须断在**这一层**，不能只依赖 `getBrowserManagerConfig()`：后者只看
 * 到它自己那份合并，store 的覆盖层可以把结果重新变成自相矛盾的组合 —— 例如
 * `BROWSER_EGO=true` + store `{ego:false, keepPage:true}`：合并层看到 `ego:true`
 * 于是放行，叠加后却变成 `{ego:false, keepPage:true}`，连接模式退回 `'launch'`
 * 且 `keepPage` 永远没人读。断言在叠加之后，检查的就是真正会被使用的那份。
 */
export function effectiveBrowserConfig(): BrowserManagerConfig {
  return toBrowserConfig(getRuntimeConfigStore().get());
}

/**
 * 一次 `browser.connect` 的 patch **若提交**会得到的生效配置，不写 store。
 *
 * 存在的理由是不变量会抛：`RuntimeConfigStore.update()` 深合并 `browser`，上一
 * 次请求留下的字段会活到这一次（`connect --ego --keep-page` 之后再来
 * `connect --ego=false`，store 会停在 `{ego:false, keepPage:true}`）。先提交再
 * 校验会把 store 永久卡在自相矛盾的状态 —— 从那以后每个 `browser.status` /
 * `browser.disconnect` 都跟着抛。调用方先拿候选、校验，通过后才 `update()`，
 * 被拒绝的请求因此不留痕迹。
 *
 * `commit()` **写的就是这里预览出来的那份对象**，不重新合并：分开算会留下一个
 * 「校验的 A、提交的 B」的窗口 —— 今天只在 preview 与 commit 之间没有 `await`
 * 时才安全，将来中间插一个异步操作就会重新打开它。因而 `commit` 直接吃掉
 * `previewed`，合并逻辑只在 `RuntimeConfigStore` 里存在一份。
 */
export function candidateBrowserConfig(patch: BrowserConfig): {
  commit: () => void;
  config: BrowserManagerConfig;
} {
  const store = getRuntimeConfigStore();
  // `preview()` 走的就是 `update()` 的合并逻辑，`config` 由它派生，`commit`
  // 提交的也是它，三者不可能再分叉。
  const previewed = store.preview({browser: patch});
  return {
    commit: () => {
      store.commit(previewed);
    },
    config: toBrowserConfig(previewed),
  };
}

/**
 * 合并层 + store 覆盖层，断言不变量后返回（唯一读点）。
 *
 * 合并顺序：环境变量/配置文件（`buildBrowserManagerConfig()`）→ store 覆盖层
 * → 本次请求 patch（已经含在 `store` 快照里）。断言在**合并结束之后**，这是
 * 唯一能同时满足两条规则的位置：
 * - `BROWSER_KEEP_PAGE=true` + `connect --ego`：中间态缺 ego，最终对象有 ego，
 *   所以合法 —— 用户能用 ego 自救；
 * - `keepPage` 有、各层都没有 ego：最终对象仍自相矛盾，照样拒绝。
 *
 * 断言不能下沉到 `buildBrowserManagerConfig()`，那样中间态就会被拒（C1 回归）。
 */
function toBrowserConfig(store: Readonly<GlobalConfig>): BrowserManagerConfig {
  const base = buildBrowserManagerConfig();
  const storeBrowser = store.browser ?? {};
  if (storeBrowser.ego === true) {
    base.browserURL = undefined;
    base.wsEndpoint = undefined;
    base.channel = undefined;
    base.executablePath = undefined;
    base.remoteDebuggingUrl = undefined;
  }
  const hasExplicitTarget =
    storeBrowser.browserURL !== undefined ||
    storeBrowser.wsEndpoint !== undefined ||
    storeBrowser.channel !== undefined ||
    storeBrowser.executablePath !== undefined;
  if (hasExplicitTarget || storeBrowser.ego === false) {
    base.ego = undefined;
    base.keepPage = undefined;
    base.egoProfile = undefined;
  }
  const config = {...base, ...storeBrowser};
  assertBrowserConfigInvariants(config);
  return {
    ...config,
    channel: config.channel as BrowserManagerConfig['channel'],
  };
}
