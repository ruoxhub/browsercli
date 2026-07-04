/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 兼容层：类型与纯函数已迁移至 modules/debugger/ExecutionContextInfo.ts。
 * 此处保留 re-export，避免 tools 层与外部测试文件的导入路径变更。
 */

export type {
  ExecutionContextInfo,
  ExecutionContextWorld,
  RawExecutionContextDescription,
} from '../../modules/debugger/ExecutionContextInfo.js';
export {
  classifyExecutionContextWorld,
  createExecutionContextInfo,
  extractExtensionId,
} from '../../modules/debugger/ExecutionContextInfo.js';
