/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/** Worker 进程运行时目录 */
export const RUNTIME_DIR_NAME = 'browsercli';

/** 用户级配置目录名 */
export const USER_CONFIG_DIR_NAME = '.browsercli';

/** 旧版用户级配置目录名（兼容回退） */
export const LEGACY_CONFIG_DIR_NAME = '.proxycli';

/** 用户级配置文件名 */
export const USER_CONFIG_FILENAME = 'config.json';

/** PLUGIN_DATA 目录下的配置文件名 */
export const PLUGIN_CONFIG_FILENAME = 'browsercli.config.json';

/** 支持的浏览器渠道列表（CDP / WebDriver BiDi / Firefox） */
export const CHANNELS = [
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
] as const;

export type ChannelInput = (typeof CHANNELS)[number];
