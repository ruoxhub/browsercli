/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export const NO_ACTIVE_PAGE_MESSAGE =
  '当前无活跃页面，请先通过 new_page 或 select_page 创建/选择页面';

export interface ActivePageResolverRuntime<PageLike> {
  getPages?(): PageLike[];
  getSelectedPage?(): PageLike | null;
  getSelectedPageIndex?(): number | null;
}

export type ActivePageResolution<PageLike> =
  | {
      ok: true;
      page: PageLike;
      pageIdx: number;
    }
  | {
      ok: false;
      message: string;
    };

export function resolveActivePage<PageLike>(
  runtime: ActivePageResolverRuntime<PageLike>,
): ActivePageResolution<PageLike> {
  const selectedPage = runtime.getSelectedPage?.() ?? null;
  if (!selectedPage) {
    return {
      ok: false,
      message: NO_ACTIVE_PAGE_MESSAGE,
    };
  }

  const selectedPageIndex = runtime.getSelectedPageIndex?.() ?? null;
  if (typeof selectedPageIndex === 'number' && selectedPageIndex >= 0) {
    return {
      ok: true,
      page: selectedPage,
      pageIdx: selectedPageIndex,
    };
  }

  const pages = runtime.getPages?.() ?? [];
  const pageIdx = pages.findIndex(page => page === selectedPage);
  if (pageIdx >= 0) {
    return {
      ok: true,
      page: selectedPage,
      pageIdx,
    };
  }

  return {
    ok: false,
    message: NO_ACTIVE_PAGE_MESSAGE,
  };
}
