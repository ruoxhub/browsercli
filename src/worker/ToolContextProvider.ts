/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolContextProvider — 从运行时环境提供 Tool 执行所需的上下文
 *
 * 接口兼容当前 Daemon 中的 context 对象，提供页面/网络/调试器等环境
 */

import type {Page} from 'playwright-core';

export class ToolContextProvider {
  private selectedPage: Page | null = null;
  private pagesList: Page[] = [];

  constructor() {}

  getSelectedPage(): Page | null {
    return this.selectedPage;
  }

  setSelectedPage(page: Page | null): void {
    this.selectedPage = page;
  }

  getPages(): Page[] {
    return this.pagesList;
  }

  setPages(pages: Page[]): void {
    this.pagesList = pages;
  }

  selectPage(page: Page): void {
    this.selectedPage = page;
  }

  getNetworkRequests(): unknown[] {
    // TODO: 集成网络请求收集器
    return [];
  }
}
