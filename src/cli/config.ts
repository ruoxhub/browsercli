/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI 层配置 — 从 src/config.ts 重新导出
 *
 * @see src/config.ts — 所有配置逻辑的统一入口
 */

// 保留原有常量导出（向后兼容）
export {DEFAULT_SEKIRO_HOST, DEFAULT_GROUP, RUNTIME_DIR_NAME} from '../config.js';

// 重新导出全局配置系统
export {
  type GlobalConfig,
  type ConfigSource,
  type ResolvedConfig,
  getUserConfigPath,
  getProjectConfigPath,
  loadUserConfig,
  loadProjectConfig,
  loadFullConfig,
  mergeConfigs,
  resolveConfig,
  initUserConfig,
  writeConfigFile,
  setUserConfigValue,
  deleteUserConfigValue,
  showConfigInfo,
} from '../config.js';
