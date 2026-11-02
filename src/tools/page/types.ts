/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

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

/** waitForElement 参数 */
export interface WaitForElementParams {
  /** 元素定位器（CSS / role= / text= / xpath=） */
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

/** checkBrowserHealth 参数（无参数） */
export type CheckBrowserHealthParams = object;

// ─── 数据类型 ──────────────────────────────────────────

/** 元素信息 */
export interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  attributes: Record<string, string>;
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

// ─── 结果类型 ──────────────────────────────────────────

/**
 * Page 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface PageResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat: string;
}

/** waitForElement 结果 */
export interface WaitForElementResult extends PageResult<WaitForElementData> {
  tooltype: 'wait_for_element';
}

/** scrollBy 结果 */
export interface ScrollByResult extends PageResult<ScrollByData> {
  tooltype: 'scroll_by';
}

/** checkBrowserHealth 结果 */
export interface CheckBrowserHealthResult extends PageResult<CheckBrowserHealthData> {
  tooltype: 'check_browser_health';
}
