/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {AxiError} from 'axi-sdk-js';
import type {AxiCliCommand} from 'axi-sdk-js';

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
  'executable-path',
  'full-stealth-args',
  'headless',
  'isolated',
  'js-stealth',
  'json',
  'minimal-stealth',
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
    '用法：proxycli browser connect|disconnect|status [options]',
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
    fullStealthArgs: booleanFlag(flags, 'full-stealth-args'),
    headless: booleanFlag(flags, 'headless'),
    isolated: booleanFlag(flags, 'isolated'),
    jsStealth: booleanFlag(flags, 'js-stealth'),
    minimalStealth: booleanFlag(flags, 'minimal-stealth'),
  };
  for (const [key, value] of Object.entries(booleans)) {
    if (value !== undefined) {
      (options as Record<string, unknown>)[key] = value;
    }
  }
  return options;
}

function renderBrowserStatus(
  action: 'connect' | 'disconnect' | 'status',
  state: BrowserConnectionStatus,
  json: boolean,
) {
  const result = {command: 'browser', action, ...state};
  if (json) return successOutput(result);
  return {
    ...tableOutput(
      ['Property', 'Value'],
      [
        ['Connected', String(state.connected)],
        ['Mode', state.mode],
        ['Pages', String(state.pages)],
      ],
    ),
    ...result,
  };
}

export const browserCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const action = parsed.positionals[0];
  if (
    parsed.positionals.length !== 1 ||
    !['connect', 'disconnect', 'status'].includes(action)
  ) {
    invalid('浏览器动作必须是 connect、disconnect 或 status');
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
  const client = ctx ? await ctx.connect() : undefined;
  if (!client) throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');

  try {
    const state =
      typedAction === 'connect'
        ? await client.request<BrowserConnectionStatus>('browser.connect', {
            body: connectOptions(parsed.flags),
          })
        : typedAction === 'disconnect'
          ? await client.request<BrowserConnectionStatus>(
              'browser.disconnect',
              force === undefined
                ? {body: {}}
                : {body: {force} satisfies BrowserDisconnectOptions},
            )
          : await client.request<BrowserConnectionStatus>('browser.status');
    return renderBrowserStatus(typedAction, state, json);
  } catch (error) {
    throw toAxiError(error, 'BROWSER_ERROR');
  } finally {
    client.close();
  }
};
