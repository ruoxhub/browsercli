/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 工具默认行为选项定义（参考 chrome-devtools-mcp/src/config/tool-options.ts）。
 */

import type {ConfigOption, ConfigOptionsFor} from './category-options.js';

interface ToolOption extends ConfigOption {
  reloadable: true;
}

export interface ToolArguments {
  screenshotFormat: 'jpeg' | 'png' | 'webp';
  screenshotQuality?: number;
  screenshotMaxWidth?: number;
  screenshotMaxHeight?: number;
}

export type ToolOptions = ConfigOptionsFor<ToolArguments, ToolOption>;

export const toolOptions: ToolOptions = {
  screenshotFormat: {
    type: 'string',
    default: 'png',
    describe: '默认截图格式',
    choices: ['jpeg', 'png', 'webp'],
    reloadable: true,
    browserKey: 'screenshotFormat',
  },
  screenshotQuality: {
    type: 'number',
    describe: '截图压缩质量（0-100）',
    reloadable: true,
    browserKey: 'screenshotQuality',
    coerce: (value: number | undefined): number | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new Error(
          `Invalid screenshotQuality ${value}. Expected an integer between 0 and 100.`,
        );
      }
      return value;
    },
  },
  screenshotMaxWidth: {
    type: 'number',
    describe: '截图最大宽度（px）',
    reloadable: true,
    browserKey: 'screenshotMaxWidth',
    coerce: (value: number | undefined): number | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(
          `Invalid screenshotMaxWidth ${value}. Expected a positive integer.`,
        );
      }
      return value;
    },
  },
  screenshotMaxHeight: {
    type: 'number',
    describe: '截图最大高度（px）',
    reloadable: true,
    browserKey: 'screenshotMaxHeight',
    coerce: (value: number | undefined): number | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(
          `Invalid screenshotMaxHeight ${value}. Expected a positive integer.`,
        );
      }
      return value;
    },
  },
};
