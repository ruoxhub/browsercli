/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

/**
 * Emulation 函数统一返回结构。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 */
export interface EmulationResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 网络节流选项 */
export type ThrottlingOption =
  | 'No emulation'
  | 'Offline'
  | 'Slow 3G'
  | 'Fast 3G'
  | 'Fast 4G'
  | (string & {});

/** emulateNetwork 参数 */
export interface EmulateNetworkParams {
  /** 网络节流选项 (如 "No emulation", "Offline", "Slow 3G" 等) */
  throttlingOption: ThrottlingOption;
}

/** emulateNetwork 结果 */
export interface EmulateNetworkResult extends EmulationResult {
  tooltype: 'emulate_network';
}

/** emulateCpu 参数 */
export interface EmulateCpuParams {
  /** CPU 降频倍率 (1-20，1 = 关闭节流) */
  throttlingRate: number;
}

/** emulateCpu 结果 */
export interface EmulateCpuResult extends EmulationResult {
  tooltype: 'emulate_cpu';
}

/** resizePage 参数 */
export interface ResizePageParams {
  /** 页面宽度 (像素) */
  width: number;
  /** 页面高度 (像素) */
  height: number;
}

/** resizePage 结果 */
export interface ResizePageResult extends EmulationResult {
  tooltype: 'resize_page';
}

/** 移动设备类型 */
export type DeviceType = 'iphone' | 'android' | 'ipad';

/** emulateMobile 参数 */
export interface EmulateMobileParams {
  /** 是否启用移动设备模拟 */
  enable: boolean;
  /** 设备类型 (默认 iphone) */
  device?: DeviceType;
}

/** 设备配置信息 */
export interface DeviceProfileData {
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
  };
  userAgent: string;
}

/** emulateMobile 结果 */
export interface EmulateMobileResult extends EmulationResult {
  tooltype: 'emulate_mobile';
  data?: {
    device?: DeviceType;
    viewport?: {width: number; height: number};
    userAgent?: string;
  };
}

/** 重新导出 Frame 类型 */
export type {Frame};
