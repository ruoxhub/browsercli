/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

/**
 * Input 函数统一返回结构。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 */
export interface InputResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
}

// ─── click ───────────────────────────────────────────────

/** click 参数 */
export interface ClickParams {
  /** CSS 选择器 */
  selector: string;
  /** 是否双击，默认 false */
  dblClick?: boolean;
}

/** click 结果 */
export interface ClickResult extends InputResult {
  tooltype: 'click';
}

// ─── click_at ─────────────────────────────────────────────

/** clickAt 参数 */
export interface ClickAtParams {
  /** CSS 选择器 */
  selector: string;
}

/** clickAt 结果数据 */
export interface ClickAtData {
  x: number;
  y: number;
  tag: string;
  text: string;
}

/** clickAt 结果 */
export interface ClickAtResult extends InputResult {
  tooltype: 'click_at';
  data: ClickAtData;
}

// ─── set_files ───────────────────────────────────────────

/** setFiles 参数 */
export interface SetFilesParams {
  /** CSS 选择器（file input 元素） */
  selector: string;
  /** 文件绝对路径列表 */
  filePaths: string[];
}

/** setFiles 结果 */
export interface SetFilesResult extends InputResult {
  tooltype: 'set_files';
  data: {
    files: number;
  };
}

// ─── hover ───────────────────────────────────────────────

/** hover 参数 */
export interface HoverParams {
  /** CSS 选择器 */
  selector: string;
}

/** hover 结果 */
export interface HoverResult extends InputResult {
  tooltype: 'hover';
}

// ─── fill ────────────────────────────────────────────────

/** fill 参数 */
export interface FillParams {
  /** CSS 选择器（input / textarea / select） */
  selector: string;
  /** 填充值 */
  value: string;
}

/** fill 结果 */
export interface FillResult extends InputResult {
  tooltype: 'fill';
}

// ─── fill_form ───────────────────────────────────────────

/** fillForm 单个元素 */
export interface FormElement {
  /** CSS 选择器 */
  selector: string;
  /** 填充值 */
  value: string;
}

/** fillForm 参数 */
export interface FillFormParams {
  /** 要填充的元素列表 */
  elements: FormElement[];
}

/** fillForm 结果 */
export interface FillFormResult extends InputResult {
  tooltype: 'fill_form';
  data: {
    filled: number;
    total: number;
  };
}

// ─── drag ────────────────────────────────────────────────

/** drag 参数 */
export interface DragParams {
  /** 拖拽源 CSS 选择器 */
  fromSelector: string;
  /** 拖拽目标 CSS 选择器 */
  toSelector: string;
}

/** drag 结果 */
export interface DragResult extends InputResult {
  tooltype: 'drag';
}

// ─── upload_file ─────────────────────────────────────────

/** uploadFile 参数 */
export interface UploadFileParams {
  /** CSS 选择器（file input 元素） */
  selector: string;
  /** 文件绝对路径 */
  filePath: string;
}

/** uploadFile 结果 */
export interface UploadFileResult extends InputResult {
  tooltype: 'upload_file';
}

// ─── press_key ───────────────────────────────────────────

/** pressKey 参数 */
export interface PressKeyParams {
  /** 按键或组合键，如 "Enter", "Control+A" */
  key: string;
}

/** pressKey 结果 */
export interface PressKeyResult extends InputResult {
  tooltype: 'press_key';
}

/** 重新导出 Frame 类型 */
export type {Frame};