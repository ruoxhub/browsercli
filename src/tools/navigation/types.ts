/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Navigation 工具已全部重构为 defineTool 格式，
// 原有的纯函数参数/返回类型不再需要。
// 保留本文件以防其他模块有类型引用，后续可移除。
import type {Browser, Page} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

// ─── 运行时服务接口 ──────────────────────────────────

/**
 * Navigation 运行时服务（从 McpContext 提取的接口）。
 *
 * 纯函数通过此接口访问页面控制和浏览器管理能力，
 * 调用方负责提供具体实现。
 */
export interface NavigationRuntimeServices {
  /** 获取所有已打开的页面 */
  getPages: () => Page[];
  /** 按索引获取页面 */
  getPageByIdx: (idx: number) => Page;
  /** 获取当前选中页面索引（可选） */
  getSelectedPageIndex?: () => number | null;
  /** 获取当前选中的页面 */
  getSelectedPage: () => Page | null;
  /** 创建新页面 */
  newPage: () => Promise<Page>;
  /** 选择页面（切换上下文） */
  selectPage: (page: Page) => void;
  /** 将页面带到前台 */
  bringPageToFront: (page: Page) => Promise<void>;
  /** 同步页面上下文 */
  syncPageContext?: (page: Page) => void;
  /** 浏览器实例（可选，用于直接操作） */
  browser?: Browser;
}

// ─── 参数类型 ──────────────────────────────────────────

/** listPages 参数（无参数） */
export type ListPagesParams = object;

/** selectPage 参数 */
export interface SelectPageParams {
  pageId?: string;
  pageIdx?: number;
}

/** newPage 参数 */
export interface NewPageParams {
  /** 要加载的 URL */
  url: string;
  /** 导航超时（毫秒），默认 10000 */
  timeout?: number;
}

/** navigatePage 参数 */
export interface NavigatePageParams {
  /** 导航类型 */
  type?: 'url' | 'back' | 'forward' | 'reload';
  /** 目标 URL（仅 type=url 时使用） */
  url?: string;
  /** 是否忽略缓存（仅 reload 时使用） */
  ignoreCache?: boolean;
  /** 导航超时（毫秒），默认 10000 */
  timeout?: number;
}

// ─── 数据类型 ──────────────────────────────────────────

/** 页面信息 */
export interface PageInfo {
  /** 页面索引 */
  index: number;
  pageId: string;
  /** 页面 URL */
  url: string;
  /** 页面标题 */
  title: string;
}

/** listPages 返回数据 */
export interface ListPagesData {
  pageInfos: PageInfo[];
  selectedIndex: number;
  selectedPageId: string | null;
}

/** selectPage 返回数据 */
export interface SelectPageData {
  selectedIndex: number;
  selectedPageId: string;
  url: string;
  title: string;
}

/** newPage 返回数据 */
export interface NewPageData {
  index: number;
  pageId: string;
  url: string;
  title: string;
}

/** navigatePage 返回数据 */
export interface NavigatePageData {
  type: string;
  url: string;
  navigated: boolean;
}

// ─── 结果类型 ──────────────────────────────────────────

/**
 * Navigation 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface NavigationResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat: string;
}

/** listPages 结果 */
export interface ListPagesResult extends NavigationResult<ListPagesData> {
  tooltype: 'list_pages';
}

/** selectPage 结果 */
export interface SelectPageResult extends NavigationResult<SelectPageData> {
  tooltype: 'select_page';
}

/** newPage 结果 */
export interface NewPageResult extends NavigationResult<NewPageData> {
  tooltype: 'new_page';
}

/** navigatePage 结果 */
export interface NavigatePageResult extends NavigationResult<NavigatePageData> {
  tooltype: 'navigate_page';
}
