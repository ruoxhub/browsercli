/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes, ToolError} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {getFrameOrRespond} from './evaluateAndRespond.js';

/**
 * 获取浏览器存储数据（cookies、localStorage、sessionStorage）。
 */
export const getStorage = defineTool({
  name: 'get_storage',
  description:
    '获取浏览器存储数据，包括 HttpOnly cookies、可复制的 Cookie 请求头、localStorage 与 sessionStorage。',
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
    filter: zod.string().optional().describe('按键名过滤（不区分大小写）。'),
  },
  handler: async (request, response, context) => {
    const {type, filter} = request.params;
    const result: Record<string, unknown> = {};
    let cookieHeader: string | undefined;
    let cookieDetails: Array<Record<string, unknown>> | undefined;

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
      if (type === 'all' || type === 'cookies') {
        const page = context.getSelectedPage();
        if (!page) {
          throw createToolError(
            ErrorCodes.PAGE_REQUIRED,
            '当前没有选中的页面',
            {toolName: 'get_storage'},
          );
        }

        let cookies: any[] = [];
        try {
          cookies = (await page.context().cookies(page.url())).filter(
            cookie =>
              !filter ||
              cookie.name.toLowerCase().includes(filter.toLowerCase()),
          );
        } catch {
          // 某些运行环境（如 ego 桥接）未暴露 Storage.getCookies，允许捕获失败并降级
        }

        // 降级回退：当 CDP cookies 为空时，尝试从页面 document.cookie 补充非 HttpOnly 的 cookie
        if (cookies.length === 0) {
          try {
            const rawCookie = await page.evaluate(() => document.cookie);
            if (rawCookie) {
              cookies = rawCookie
                .split(';')
                .map(pair => {
                  const [name, ...rest] = pair.trim().split('=');
                  return {
                    name,
                    value: rest.join('='),
                    domain: '',
                    path: '/',
                  };
                })
                .filter(
                  c =>
                    Boolean(c.name) &&
                    (!filter ||
                      c.name.toLowerCase().includes(filter.toLowerCase())),
                );
            }
          } catch {
            // 忽略 evaluate 错误
          }
        }

        result.cookies = Object.fromEntries(
          cookies.map(cookie => [cookie.name, cookie.value]),
        );
        cookieHeader = cookies
          .map(cookie => `${cookie.name}=${cookie.value}`)
          .join('; ');
        cookieDetails = cookies as unknown as Array<Record<string, unknown>>;
      }

      if (
        type === 'all' ||
        type === 'localStorage' ||
        type === 'sessionStorage'
      ) {
        const frame = getFrameOrRespond(
          context as Context,
          response,
          'get_storage',
        );
        Object.assign(result, await frame.evaluate(storageCode));
      }

      response.setStructuredContent({
        success: true,
        message: `存储数据${filter ? ` (过滤: "${filter}")` : ''}`,
        tooltype: 'get_storage',
        data: {
          type: type || 'all',
          filter: filter || null,
          storage: result,
          ...(cookieHeader === undefined ? {} : {cookieHeader, cookieDetails}),
        },
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `错误：${error instanceof Error ? error.message : String(error)}`,
        {
          toolName: 'get_storage',
          type: request.params.type || 'all',
          filter: request.params.filter || null,
        },
      );
    }
  },
});
