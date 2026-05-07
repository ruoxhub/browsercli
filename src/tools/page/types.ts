/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';

// ─── 运行时服务接口 ──────────────────────────────────

/**
 * Page 运行时服务（从 McpContext 提取的接口）。
 *
 * 纯函数通过此接口访问页面控制和浏览器管理能力，
 * 调用方负责提供具体实现。
 */
export interface PageRuntimeServices {
  /** 获取当前活跃页面的 Puppeteer Page 对象 */
  getActivePage: () => Promise<Page>;
  /** 浏览器是否已连接 */
  isBrowserConnected: () => boolean;
  /** Collector 是否正在运行 */
  isCollectorRunning: () => Promise<boolean>;
}

// ─── 参数类型 ──────────────────────────────────────────

/** clickElement 参数 */
export interface ClickElementParams {
  /** CSS 选择器 */
  selector: string;
}

/** typeText 参数 */
export interface TypeTextParams {
  /** CSS 选择器 */
  selector: string;
  /** 输入文本 */
  text: string;
  /** 逐字输入间隔（毫秒） */
  delay?: number;
}

/** waitForElement 参数 */
export interface WaitForElementParams {
  /** CSS 选择器 */
  selector: string;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/** scrollBy 参数 */
export interface ScrollByParams {
  /** 滚动方向 */
  direction: 'up' | 'down' | 'top' | 'bottom';
  /** 滚动像素（仅用于 up/down，默认 1000） */
  pixels?: number;
}

/** saveSessionState 参数 */
export interface SaveSessionStateParams {
  /** 会话 ID，省略则自动生成 */
  sessionId?: string;
  /** 是否包含 cookies */
  includeCookies?: boolean;
  /** 是否包含 localStorage */
  includeLocalStorage?: boolean;
  /** 是否包含 sessionStorage */
  includeSessionStorage?: boolean;
}

/** restoreSessionState 参数 */
export interface RestoreSessionStateParams {
  /** 会话 ID */
  sessionId: string;
  /** 是否导航到保存时的 URL */
  navigateToSavedUrl?: boolean;
  /** 恢复前是否清除现有存储 */
  clearStorageBeforeRestore?: boolean;
}

/** listSessionStates 参数（无参数） */
export interface ListSessionStatesParams {}

/** deleteSessionState 参数 */
export interface DeleteSessionStateParams {
  /** 会话 ID */
  sessionId: string;
}

/** dumpSessionState 参数 */
export interface DumpSessionStateParams {
  /** 会话 ID */
  sessionId: string;
  /** 导出文件路径 */
  path?: string;
  /** 是否美化输出 */
  pretty?: boolean;
  /** 是否加密 */
  encrypt?: boolean;
}

/** loadSessionState 参数 */
export interface LoadSessionStateParams {
  /** 会话 ID */
  sessionId?: string;
  /** 从文件路径加载 */
  path?: string;
  /** 从 JSON 字符串加载 */
  snapshotJson?: string;
  /** 是否覆盖已存在的快照 */
  overwrite?: boolean;
}

/** checkBrowserHealth 参数（无参数） */
export interface CheckBrowserHealthParams {}

// ─── 数据类型 ──────────────────────────────────────────

/** 元素信息 */
export interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  attributes: Record<string, string>;
}

/** clickElement 返回数据 */
export interface ClickElementData {
  selector: string;
  clicked: boolean;
}

/** typeText 返回数据 */
export interface TypeTextData {
  selector: string;
  textLength: number;
  typed: boolean;
}

/** waitForElement 返回数据 */
export interface WaitForElementData {
  selector: string;
  appeared: boolean;
  element: ElementInfo | null;
}

/** scrollBy 返回数据 */
export interface ScrollByData {
  direction: string;
  pixels: number;
  result: string;
}

/** 会话快照 */
export interface SessionSnapshot {
  id: string;
  savedAt: string;
  expiresAt: string;
  url: string;
  title: string;
  cookies: Array<Record<string, unknown>>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

/** saveSessionState 返回数据 */
export interface SaveSessionStateData {
  sessionId: string;
  savedAt: string;
  url: string;
  title: string;
  counts: {
    cookies: number;
    localStorage: number;
    sessionStorage: number;
  };
}

/** restoreSessionState 返回数据 */
export interface RestoreSessionStateData {
  sessionId: string;
  restoredAt: string;
  url: string;
  restored: {
    cookies: number;
    localStorage: number;
    sessionStorage: number;
  };
}

/** listSessionStates 返回数据 */
export interface ListSessionStatesData {
  total: number;
  cleanedExpired: number;
  sessions: Array<{
    sessionId: string;
    savedAt: string;
    url: string;
    title: string;
    counts: {cookies: number; localStorage: number; sessionStorage: number};
    expiresAt: string;
  }>;
}

/** deleteSessionState 返回数据 */
export interface DeleteSessionStateData {
  sessionId: string;
  deleted: boolean;
  remaining: number;
}

/** dumpSessionState 返回数据 */
export interface DumpSessionStateData {
  sessionId: string;
  path: string | null;
  bytes: number;
  encrypted: boolean;
}

/** loadSessionState 返回数据 */
export interface LoadSessionStateData {
  sessionId: string;
  loaded: boolean;
  source: 'memory' | 'file' | 'json';
  overwritten?: boolean;
  counts: {
    cookies: number;
    localStorage: number;
    sessionStorage: number;
  };
}

/** 健康检查问题 */
export interface HealthIssue {
  code: string;
  message: string;
}

/** checkBrowserHealth 返回数据 */
export interface CheckBrowserHealthData {
  healthy: boolean;
  connected: boolean;
  pageReady: boolean;
  currentPage: {url: string | null; title: string | null};
  recommendations: string[];
  issues: HealthIssue[];
}

import type {MessagesResult} from '../shared/types.js';

// ─── 结果类型 ──────────────────────────────────────────

/**
 * Page 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface PageResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat: string;
}

/** clickElement 结果 */
export interface ClickElementResult extends PageResult<ClickElementData> {
  tooltype: 'click_element';
}

/** typeText 结果 */
export interface TypeTextResult extends PageResult<TypeTextData> {
  tooltype: 'type_text';
}

/** waitForElement 结果 */
export interface WaitForElementResult extends PageResult<WaitForElementData> {
  tooltype: 'wait_for_element';
}

/** scrollBy 结果 */
export interface ScrollByResult extends PageResult<ScrollByData> {
  tooltype: 'scroll_by';
}

/** saveSessionState 结果 */
export interface SaveSessionStateResult
  extends PageResult<SaveSessionStateData> {
  tooltype: 'save_session_state';
}

/** restoreSessionState 结果 */
export interface RestoreSessionStateResult
  extends PageResult<RestoreSessionStateData> {
  tooltype: 'restore_session_state';
}

/** listSessionStates 结果 */
export interface ListSessionStatesResult
  extends PageResult<ListSessionStatesData> {
  tooltype: 'list_session_states';
}

/** deleteSessionState 结果 */
export interface DeleteSessionStateResult
  extends PageResult<DeleteSessionStateData> {
  tooltype: 'delete_session_state';
}

/** dumpSessionState 结果 */
export interface DumpSessionStateResult
  extends PageResult<DumpSessionStateData> {
  tooltype: 'dump_session_state';
}

/** loadSessionState 结果 */
export interface LoadSessionStateResult
  extends PageResult<LoadSessionStateData> {
  tooltype: 'load_session_state';
}

/** checkBrowserHealth 结果 */
export interface CheckBrowserHealthResult
  extends PageResult<CheckBrowserHealthData> {
  tooltype: 'check_browser_health';
}
