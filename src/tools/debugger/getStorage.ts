/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import type {GetStorageParams, GetStorageResult} from './types.js';

/**
 * 获取浏览器存储数据（cookies、localStorage、sessionStorage）。
 *
 * @param frame - Puppeteer Frame 对象
 * @param params - 存储参数
 * @returns 结构化结果对象，data 包含存储数据
 */
export async function getStorage(
  frame: Frame,
  params: GetStorageParams = {},
): Promise<GetStorageResult> {
  const {type = 'all', filter} = params;

  const storageCode = `
(function() {
  const type = ${JSON.stringify(type)};
  const filter = ${JSON.stringify(filter)};
  const result = {};

  function matchFilter(key) {
    if (!filter) return true;
    return key.toLowerCase().includes(filter.toLowerCase());
  }

  if (type === 'all' || type === 'cookies') {
    const cookies = {};
    document.cookie.split(';').forEach(c => {
      const [name, ...valueParts] = c.trim().split('=');
      if (name && matchFilter(name)) {
        cookies[name] = valueParts.join('=');
      }
    });
    result.cookies = cookies;
  }

  if (type === 'all' || type === 'localStorage') {
    const local = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && matchFilter(key)) {
        try {
          const value = localStorage.getItem(key);
          try {
            local[key] = JSON.parse(value);
          } catch {
            local[key] = value;
          }
        } catch(e) {
          local[key] = '[Error reading]';
        }
      }
    }
    result.localStorage = local;
  }

  if (type === 'all' || type === 'sessionStorage') {
    const session = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && matchFilter(key)) {
        try {
          const value = sessionStorage.getItem(key);
          try {
            session[key] = JSON.parse(value);
          } catch {
            session[key] = value;
          }
        } catch(e) {
          session[key] = '[Error reading]';
        }
      }
    }
    result.sessionStorage = session;
  }

  return result;
})();
`;

  try {
    const result = await frame.evaluate(storageCode);

    return {
      success: true,
      message: `存储数据获取完成${filter ? ` (过滤: "${filter}")` : ''}`,
      tooltype: 'get_storage',
      logFormat: 'json',
      data: result as Record<string, unknown>,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_storage',
    };
  }
}
