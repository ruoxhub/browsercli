/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {emulateNetwork} from './emulateNetwork.js';
export {emulateCpu} from './emulateCpu.js';
export {resizePage} from './resizePage.js';
export {emulateMobile, DEVICE_PROFILES, DESKTOP_VIEWPORT} from './emulateMobile.js';
export type {
  EmulationResult,
  ThrottlingOption,
  EmulateNetworkParams,
  EmulateNetworkResult,
  EmulateCpuParams,
  EmulateCpuResult,
  ResizePageParams,
  ResizePageResult,
  DeviceType,
  EmulateMobileParams,
  DeviceProfileData,
  EmulateMobileResult,
  Frame,
} from './types.js';
