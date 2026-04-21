/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

/**
 * DOM 函数统一返回结构。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 */
export interface DomResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 元素信息（对应 DOMInspector.ElementInfo） */
export interface ElementInfo {
  found: boolean;
  nodeId?: number;
  nodeName?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  visible?: boolean;
}

/** 可点击元素信息（对应 DOMInspector.ClickableElement） */
export interface ClickableElement {
  selector: string;
  text: string;
  type: 'button' | 'link' | 'input' | 'other';
  visible: boolean;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** queryDom 参数 */
export interface QueryDomParams {
  /** CSS 选择器 */
  selector: string;
  /** 是否查询所有匹配元素（默认 false，仅查询第一个） */
  all?: boolean;
  /** 查询所有时的最大返回数量（默认 50） */
  limit?: number;
}

/** queryDom 结果 */
export interface QueryDomResult extends DomResult {
  tooltype: 'query_dom';
  data?: ElementInfo | ElementInfo[];
}

/** getDomStructure 参数 */
export interface GetDomStructureParams {
  /** DOM 树最大深度（默认 3） */
  maxDepth?: number;
  /** 是否包含文本内容（默认 true） */
  includeText?: boolean;
}

/** getDomStructure 结果 */
export interface GetDomStructureResult extends DomResult {
  tooltype: 'get_dom_structure';
  data?: Record<string, unknown>;
}

/** findClickableElements 参数 */
export interface FindClickableElementsParams {
  /** 按文本内容过滤（可选） */
  filterText?: string;
}

/** findClickableElements 结果 */
export interface FindClickableElementsResult extends DomResult {
  tooltype: 'find_clickable_elements';
  data?: ClickableElement[];
}

/** 重新导出 Frame 类型 */
export type {Frame};
