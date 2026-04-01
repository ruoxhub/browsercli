/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum ToolCategory {
  NAVIGATION = 'navigation',
  NETWORK = 'network',
  DEBUGGING = 'debugging',
  REVERSE_ENGINEERING = 'reverse_engineering',
  INPUT = 'input',
  EMULATION = 'emulation',
  PERFORMANCE = 'performance',
  DOM = 'dom',
  SCREENSHOT = 'screenshot',
  PAGES = 'pages',
  DATA = 'data',
}

export const labels = {
  [ToolCategory.NAVIGATION]: 'Navigation automation',
  [ToolCategory.NETWORK]: 'Network',
  [ToolCategory.DEBUGGING]: 'Debugging',
  [ToolCategory.REVERSE_ENGINEERING]: 'JS Reverse Engineering',
  [ToolCategory.INPUT]: 'Input automation',
  [ToolCategory.EMULATION]: 'Emulation',
  [ToolCategory.PERFORMANCE]: 'Performance',
  [ToolCategory.DOM]: 'DOM manipulation',
  [ToolCategory.SCREENSHOT]: 'Screenshot',
  [ToolCategory.PAGES]: 'Pages',
  [ToolCategory.DATA]: 'Data',
};
