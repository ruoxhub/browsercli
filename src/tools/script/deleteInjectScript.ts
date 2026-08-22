/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {getInjectConfigStore} from './createInjectScript.js';
import type {DeleteInjectScriptResult} from './types.js';

/**
 * 删除注入脚本配置（纯函数版本）。
 *
 * 从配置存储中移除指定 ID 的脚本配置。
 *
 * @param id - 要删除的脚本 ID
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export function deleteInjectScript(id: string): DeleteInjectScriptResult {
  const injectConfigs = getInjectConfigStore();
  const config = injectConfigs.get(id);

  if (!config) {
    throw createToolError(
      ErrorCodes.NOT_FOUND,
      `未找到 ID 为 "${id}" 的注入脚本`,
      {toolName: 'delete_inject_script', id},
    );
  }

  const name = config.name;
  injectConfigs.delete(id);

  return {
    success: true,
    message: `注入脚本 "${name}" 已删除`,
    tooltype: 'delete_inject_script',
    logFormat: 'json',
    data: {id, name},
  };
}
