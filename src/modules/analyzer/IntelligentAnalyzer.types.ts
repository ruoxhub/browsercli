/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * IntelligentAnalyzer 输入数据契约
 *
 * 这些是 analyzer 模块对外约定的纯数据形状，
 * 调用方负责把任意来源（CDP、Playwright、磁盘日志、HAR）适配成这里定义的形状。
 * 与 src/modules/collector 与 src/tools/network|console 解耦。
 */

export interface AnalyzerNetworkRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  postData?: string;
  timestamp?: number;
  type?: string;
}

export interface AnalyzerNetworkResponse {
  url: string;
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  mimeType: string;
  timestamp: number;
}

export type AnalyzerConsoleMessageType =
  | 'log'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'trace'
  | 'dir'
  | 'table'
  | string;

export interface AnalyzerConsoleMessage {
  type: AnalyzerConsoleMessageType;
  text: string;
  url?: string;
  timestamp?: number;
}

export interface AnalyzerExceptionInfo {
  text: string;
  exceptionId?: number;
  url?: string;
  timestamp?: number;
}

export interface EncryptionPattern {
  type: 'AES' | 'RSA' | 'MD5' | 'SHA' | 'Base64' | 'Custom';
  location: string;
  confidence: number;
  evidence: string[];
}

export interface SignaturePattern {
  type: 'HMAC' | 'JWT' | 'Custom';
  location: string;
  parameters: string[];
  confidence: number;
}

export interface TokenPattern {
  type: 'OAuth' | 'JWT' | 'Custom';
  location: string;
  format: string;
  confidence: number;
}

export interface AntiDebugPattern {
  type: 'debugger' | 'console.log' | 'devtools-detect' | 'timing-check';
  location: string;
  code: string;
}
