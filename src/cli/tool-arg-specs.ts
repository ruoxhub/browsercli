/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

export type ToolArgType = 'string' | 'number' | 'boolean' | 'string[]';

export interface ToolArgSpec {
  type: ToolArgType;
  required?: boolean;
  defaultValue?: unknown;
  enum?: string[];
  aliases?: string[];
  description: string;
}

export type ToolArgSpecMap = Record<string, ToolArgSpec>;

export const TOOL_ARG_SPECS: Record<string, ToolArgSpecMap> = {
  scroll_by: {
    direction: {
      type: 'string',
      required: true,
      enum: ['up', 'down', 'top', 'bottom'],
      description: '滚动方向',
    },
    pixels: {
      type: 'number',
      description: '滚动像素，仅 up/down 使用',
    },
  },
  evaluate_script: {
    function: {
      type: 'string',
      required: true,
      description: '待执行函数源码',
    },
    context: {
      type: 'string',
      defaultValue: 'page',
      enum: ['page', 'content-script'],
      description: '执行上下文',
    },
    verbose: {
      type: 'boolean',
      defaultValue: false,
      description: '是否返回底层堆栈',
    },
  },
} satisfies Record<string, ToolArgSpecMap>;
