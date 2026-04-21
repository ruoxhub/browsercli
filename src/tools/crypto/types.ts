/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

/**
 * Hook 函数统一返回结构。
 *
 * 成功时 success=true，message 包含安装确认；
 * 失败时 success=false，message 包含错误描述。
 */
export interface HookResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 已 Hook 的算法列表（hookCryptoJS / hookSMCrypto 返回） */
  algorithms?: string[];
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 日志输出格式 */
export type LogFormat = 'full' | 'compact' | 'json';

/** CryptoJS 支持的算法类型 */
export type CryptoJSAlgorithm = 'AES' | 'DES' | 'MD5' | 'SHA' | 'HMAC' | 'all';

/** SM-crypto 支持的算法类型 */
export type SMAlgorithm = 'SM2' | 'SM3' | 'SM4' | 'all';

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};