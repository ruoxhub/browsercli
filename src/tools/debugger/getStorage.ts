/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 获取浏览器存储数据（cookies、localStorage、sessionStorage）。
 */
export const getStorage = defineTool({
  name: 'get_storage',
  description:
    'Gets browser storage data including cookies, localStorage, and sessionStorage.',
  annotations: {
    title: '获取存储',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    type: zod
      .enum(['all', 'cookies', 'localStorage', 'sessionStorage'])
      .optional()
      .default('all')
      .describe('要获取的存储类型（默认: all）。'),
    filter: zod
      .string()
      .optional()
      .describe('按键名过滤（不区分大小写）。'),
  },
  handler: async (request, response, context) => {
    const {type, filter} = request.params;

    const storageCode = `
(function() {
  const type = ${JSON.stringify(type)};
  const filter = ${JSON.stringify(filter)};
  const result = {};

  function matchFilter(key) {
    if (!filter) return true;
    return key.toLowerCase().includes(filter.toLowerCase());
  }

  function readNamedStorage(storage) {
    const out = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !matchFilter(key)) continue;
      try {
        const value = storage.getItem(key);
        try {
          out[key] = JSON.parse(value);
        } catch {
          out[key] = value;
        }
      } catch {
        out[key] = '[Error reading]';
      }
    }
    return out;
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
    result.localStorage = readNamedStorage(localStorage);
  }

  if (type === 'all' || type === 'sessionStorage') {
    result.sessionStorage = readNamedStorage(sessionStorage);
  }

  return result;
})();
`;

    try {
      const frame = (context as Context).getSelectedFrame();
      const result = await frame.evaluate(storageCode);

      response.setStructuredContent({
        success: true,
        message: `存储数据${filter ? ` (过滤: "${filter}")` : ''}`,
        tooltype: 'get_storage',
        data: {
          type: type || 'all',
          filter: filter || null,
          storage: result
        }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_storage',
        data: {
          type: request.params.type || 'all',
          filter: request.params.filter || null
        }
      });
    }
  },
});
