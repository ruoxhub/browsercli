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
import {getBrowserManagerConfig} from '../config/servicesConfig.js';
import type {BrowserManagerConfig} from '../modules/browser/index.js';

const BrowserConnectSchema = BrowserConfigSchema.pick({
  acceptInsecureCerts: true,
  browserURL: true,
  channel: true,
  cloak: true,
  ego: true,
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
  if (
    patch.browserURL &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(patch.browserURL)
  ) {
    patch.browserURL = `http://${patch.browserURL}`;
  }
  if (Object.hasOwn(parsed.data, 'browserURL')) {
    patch.wsEndpoint = undefined;
    patch.channel = undefined;
    patch.executablePath = undefined;
    patch.remoteDebuggingUrl = undefined;
  } else if (Object.hasOwn(parsed.data, 'wsEndpoint')) {
    patch.browserURL = undefined;
    patch.channel = undefined;
    patch.executablePath = undefined;
    patch.remoteDebuggingUrl = undefined;
  } else if (Object.hasOwn(parsed.data, 'channel')) {
    patch.browserURL = undefined;
    patch.wsEndpoint = undefined;
    patch.executablePath = undefined;
    patch.remoteDebuggingUrl = undefined;
  } else if (Object.hasOwn(parsed.data, 'executablePath')) {
    patch.browserURL = undefined;
    patch.wsEndpoint = undefined;
    patch.channel = undefined;
    patch.remoteDebuggingUrl = undefined;
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
 */
export function candidateBrowserConfig(patch: BrowserConfig): {
  commit: () => void;
  config: BrowserManagerConfig;
} {
  const store = getRuntimeConfigStore();
  return {
    commit: () => {
      store.update({browser: patch});
    },
    // `preview()` 走的就是 `update()` 的合并逻辑，所以校验对象与提交后读到的一致。
    config: toBrowserConfig(store.preview({browser: patch})),
  };
}

/** 合并层 + store 覆盖层，断言不变量后返回（唯一读点）。 */
function toBrowserConfig(store: Readonly<GlobalConfig>): BrowserManagerConfig {
  const config = {...getBrowserManagerConfig(), ...(store.browser ?? {})};
  assertBrowserConfigInvariants(config);
  return {
    ...config,
    channel: config.channel as BrowserManagerConfig['channel'],
  };
}
