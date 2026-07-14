/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

/** hookCryptoJS / hookSMCrypto 返回数据 */
export interface CryptoHookData {
  /** 已 Hook 的算法列表 */
  algorithms?: string[];
}

/**
 * Crypto Hook 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface HookResult<T = unknown> extends MessagesResult<T> {
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
