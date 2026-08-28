/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// 两条抓包链路 → CapturedRequestInput 的纯映射（spec §5）。
export {toCapturedRequestInput as fromMitmExchange} from './MitmRequestAdapter.js';
export {
  cdpResponseToInput as fromCdpResponse,
  readCdpResponseBody,
} from './CdpRequestAdapter.js';
