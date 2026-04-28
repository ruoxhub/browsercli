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
  // === P0 核心工具参数规范 ===
  collect_code: {
    url: {type: 'string', required: true, description: '目标页面 URL'},
    returnMode: {
      type: 'string',
      defaultValue: 'full',
      enum: ['full', 'summary', 'pattern', 'top-priority'],
      description: '返回模式',
    },
    includeInline: {
      type: 'boolean',
      defaultValue: true,
      description: '是否包含内联脚本',
    },
    includeExternal: {
      type: 'boolean',
      defaultValue: true,
      description: '是否包含外部脚本',
    },
    includeDynamic: {
      type: 'boolean',
      defaultValue: false,
      description: '是否包含动态脚本',
    },
    pattern: {
      type: 'string',
      description: 'URL 匹配正则（returnMode=pattern 时使用）',
    },
    limit: {type: 'number', description: '最大返回文件数'},
    maxTotalSize: {type: 'number', description: '最大总大小（字节）'},
  },
  search_in_scripts: {
    pattern: {type: 'string', required: true, description: 'URL 匹配正则'},
    limit: {type: 'number', description: '最大返回数量'},
    maxTotalSize: {type: 'number', description: '最大总大小（字节）'},
  },
  search_in_sources: {
    query: {type: 'string', required: true, description: '搜索关键词'},
    scriptId: {type: 'string', description: '限定脚本 ID'},
    caseSensitive: {
      type: 'boolean',
      defaultValue: false,
      description: '是否区分大小写',
    },
    isRegex: {
      type: 'boolean',
      defaultValue: false,
      description: '是否使用正则',
    },
    maxResults: {type: 'number', description: '最大结果数'},
    contextLines: {type: 'number', description: '上下文行数'},
    contextChars: {
      type: 'number',
      description: '上下文字符数（适合单行压缩 JS）',
    },
    maxLineLength: {type: 'number', description: '单行最大长度'},
    urlFilter: {type: 'string', description: 'URL 过滤关键词'},
  },
  trace_function: {
    target: {
      type: 'string',
      required: true,
      description: '目标函数路径（如 XMLHttpRequest.prototype.open）',
    },
    logArgs: {type: 'boolean', defaultValue: true, description: '是否记录参数'},
    logResult: {
      type: 'boolean',
      defaultValue: true,
      description: '是否记录返回值',
    },
    logStack: {
      type: 'boolean',
      defaultValue: false,
      description: '是否记录调用栈',
    },
    hookId: {type: 'string', description: '自定义 Hook ID'},
  },
  hook_function: {
    target: {
      type: 'string',
      required: true,
      description: '目标函数路径（如 XMLHttpRequest.prototype.open）',
    },
    logArgs: {type: 'boolean', defaultValue: true, description: '是否记录参数'},
    logResult: {
      type: 'boolean',
      defaultValue: true,
      description: '是否记录返回值',
    },
    logStack: {
      type: 'boolean',
      defaultValue: false,
      description: '是否记录调用栈',
    },
    hookId: {type: 'string', description: '自定义 Hook ID'},
  },
  evaluate_on_callframe: {
    expression: {type: 'string', required: true, description: '待执行表达式'},
    callFrameId: {
      type: 'string',
      description: '调用帧 ID（默认使用顶层帧）',
    },
  },
  set_breakpoint: {
    url: {type: 'string', required: true, description: '脚本 URL'},
    lineNumber: {
      type: 'number',
      required: true,
      description: '行号（从 0 开始）',
    },
    columnNumber: {type: 'number', description: '列号'},
    condition: {type: 'string', description: '断点条件表达式'},
    isRegex: {
      type: 'boolean',
      defaultValue: false,
      description: 'URL 是否为正则',
    },
  },
  get_script_source: {
    scriptId: {type: 'string', description: '脚本 ID'},
    urlPattern: {type: 'string', description: 'URL 匹配模式'},
    offset: {type: 'number', defaultValue: 0, description: '字符偏移量'},
    limit: {type: 'number', description: '最大字符数'},
  },
  find_in_script: {
    scriptId: {type: 'string', required: true, description: '脚本 ID'},
    query: {type: 'string', required: true, description: '搜索关键词'},
    caseSensitive: {
      type: 'boolean',
      defaultValue: false,
      description: '是否区分大小写',
    },
  },
  wasm_dump: {
    moduleIndex: {
      type: 'number',
      defaultValue: 0,
      description: 'WASM 模块索引',
    },
    outputPath: {type: 'string', description: '输出 .wasm 文件路径'},
  },
  wasm_disassemble: {
    inputPath: {
      type: 'string',
      required: true,
      description: '输入 .wasm 文件路径',
    },
    outputPath: {type: 'string', description: '输出 .wat 文件路径'},
    foldExprs: {
      type: 'boolean',
      defaultValue: true,
      description: '是否折叠表达式',
    },
  },
  wasm_decompile: {
    inputPath: {
      type: 'string',
      required: true,
      description: '输入 .wasm 文件路径',
    },
    outputPath: {type: 'string', description: '输出反编译文件路径'},
  },
  wasm_inspect_sections: {
    inputPath: {
      type: 'string',
      required: true,
      description: '输入 .wasm 文件路径',
    },
    sections: {
      type: 'string',
      defaultValue: 'details',
      enum: ['headers', 'details', 'disassemble', 'all'],
      description: '检查范围',
    },
  },
  wasm_offline_run: {
    inputPath: {
      type: 'string',
      required: true,
      description: '输入 .wasm 文件路径',
    },
    functionName: {type: 'string', required: true, description: '导出函数名'},
    args: {type: 'string[]', description: '函数参数'},
    runtime: {
      type: 'string',
      defaultValue: 'auto',
      enum: ['wasmtime', 'wasmer', 'auto'],
      description: 'WASM 运行时',
    },
    timeoutMs: {
      type: 'number',
      defaultValue: 10000,
      description: '执行超时毫秒数',
    },
  },
  wasm_optimize: {
    inputPath: {
      type: 'string',
      required: true,
      description: '输入 .wasm 文件路径',
    },
    outputPath: {type: 'string', description: '输出优化后 .wasm 文件路径'},
    level: {
      type: 'string',
      defaultValue: 'O2',
      enum: ['O1', 'O2', 'O3', 'O4', 'Os', 'Oz'],
      description: '优化级别',
    },
  },
  wasm_vmp_trace: {
    maxEvents: {
      type: 'number',
      defaultValue: 5000,
      description: '最大 trace 事件数',
    },
    filterModule: {type: 'string', description: '按 import module 名过滤'},
  },
  wasm_memory_inspect: {
    offset: {type: 'number', defaultValue: 0, description: '起始字节偏移'},
    length: {type: 'number', defaultValue: 256, description: '读取字节数'},
    format: {
      type: 'string',
      defaultValue: 'both',
      enum: ['hex', 'ascii', 'both'],
      description: '输出格式',
    },
    searchPattern: {type: 'string', description: '待搜索的 hex 或 ASCII 模式'},
  },
} satisfies Record<string, ToolArgSpecMap>;
