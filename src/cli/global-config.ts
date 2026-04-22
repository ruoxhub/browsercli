/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 全局配置文件管理 — 从 src/config.ts 重新导出
 *
 * @see src/config.ts — 所有配置逻辑的统一入口
 */

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
