/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 浏览器运行态约束选项（参考 chrome-devtools-mcp/src/config/puppeteer-options.ts）。
 */

import type {ConfigOption, ConfigOptionsFor} from './category-options.js';
import {validateUrlPatterns} from './urlPattern.js';

export interface RuntimeArguments {
  viewport?: {width: number; height: number};
  acceptInsecureCerts: boolean;
  blockedUrlPattern?: string[];
  allowedUrlPattern?: string[];
}

export type RuntimeOptions = ConfigOptionsFor<RuntimeArguments, ConfigOption>;

export const runtimeOptions: RuntimeOptions = {
  viewport: {
    type: 'string',
    describe: '窗口视口尺寸（如 1280x720）',
    browserKey: 'viewport',
    coerce: (arg: unknown): {width: number; height: number} | undefined => {
      if (arg === undefined) {
        return undefined;
      }
      if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        const record = arg as Record<string, unknown>;
        const width = Number(record.width);
        const height = Number(record.height);
        if (
          Number.isInteger(width) &&
          Number.isInteger(height) &&
          width > 0 &&
          height > 0
        ) {
          return {width, height};
        }
        throw new Error(
          'Invalid viewport. Expected format is `1280x720` with positive integer width and height.',
        );
      }
      if (typeof arg !== 'string') {
        throw new Error(
          'Invalid viewport. Expected format is `1280x720` with positive integer width and height.',
        );
      }
      const parts = arg.split('x');
      if (parts.length !== 2) {
        throw new Error(
          'Invalid viewport. Expected format is `1280x720` with positive integer width and height.',
        );
      }
      const [width, height] = parts.map(Number);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0
      ) {
        throw new Error(
          'Invalid viewport. Expected format is `1280x720` with positive integer width and height.',
        );
      }
      return {width, height};
    },
  },
  acceptInsecureCerts: {
    type: 'boolean',
    default: false,
    describe: '忽略自签名和过期证书错误',
    envKey: 'BROWSER_ACCEPT_INSECURE_CERTS',
    browserKey: 'acceptInsecureCerts',
  },
  blockedUrlPattern: {
    type: 'array',
    string: true,
    reloadable: true,
    describe: '阻止指定 URL Pattern',
    browserKey: 'blockedUrlPattern',
    coerce: (arg: string[] | undefined): string[] | undefined => {
      if (arg === undefined || arg.length === 0) {
        return undefined;
      }
      validateUrlPatterns(arg, '--blockedUrlPattern');
      return arg;
    },
  },
  allowedUrlPattern: {
    type: 'array',
    string: true,
    reloadable: true,
    describe: '仅允许指定 URL Pattern',
    browserKey: 'allowedUrlPattern',
    coerce: (arg: string[] | undefined): string[] | undefined => {
      if (arg === undefined) {
        return undefined;
      }
      if (arg.length === 0) {
        throw new Error(
          'Invalid --allowedUrlPattern: at least one pattern is required.',
        );
      }
      validateUrlPatterns(arg, '--allowedUrlPattern');
      return arg;
    },
  },
};
