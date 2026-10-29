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

import {getRuntimeConfigStore} from '../config/RuntimeConfigStore.js';
import {type BrowserConfig, BrowserConfigSchema} from '../config/schema.js';
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

export function effectiveBrowserConfig(): BrowserManagerConfig {
  const config = {
    ...getBrowserManagerConfig(),
    ...(getRuntimeConfigStore().get().browser ?? {}),
  };
  return {
    ...config,
    channel: config.channel as BrowserManagerConfig['channel'],
  };
}
