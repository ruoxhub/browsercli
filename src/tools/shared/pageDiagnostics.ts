/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {normalizeBrowserRuntimeError} from './browserRuntime.js';

export function explainPageError(error: unknown, action: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = normalizeBrowserRuntimeError(error);

  if (
    /Target page closed/i.test(raw) ||
    /Target page, context or browser has been closed/i.test(raw) ||
    /当前页面、上下文或浏览器已关闭/.test(normalized)
  ) {
    return `${action}失败：页面已关闭，请先通过 list_pages 确认页面状态，必要时用 new_page 新建页面或用 select_page 切换到可用页面`;
  }

  if (/timeout|timed out|超时/i.test(raw)) {
    return `${action}失败：操作超时，请确认页面仍在加载或站点未卡住，必要时提高 timeout 参数后重试`;
  }

  return `${action}失败：${normalized}`;
}
