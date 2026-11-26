/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';

import {getPersistentCdpSession} from './cdpUtils.js';

export interface GeolocationOptions {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface ViewportOptions {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  isLandscape?: boolean;
  hasTouch?: boolean;
}

export type ForcedColors = 'active' | 'none';
export type PrefersContrast = 'more' | 'less' | 'custom' | 'no-preference';
export type PrefersReducedMotion = 'reduce' | 'no-preference';

export interface EmulateOptions {
  networkConditions?: string;
  cpuThrottlingRate?: number;
  geolocation?: GeolocationOptions;
  userAgent?: string;
  colorScheme?: 'dark' | 'light' | 'auto';
  forcedColors?: ForcedColors | 'auto';
  prefersContrast?: PrefersContrast | 'auto';
  prefersReducedMotion?: PrefersReducedMotion | 'auto';
  viewport?: ViewportOptions;
  extraHttpHeaders?: Record<string, string>;
}

interface NetworkConditionSpec {
  offline: boolean;
  downloadThroughput: number;
  uploadThroughput: number;
  latency: number;
}

export const PREDEFINED_NETWORK_CONDITIONS: Record<
  string,
  NetworkConditionSpec
> = {
  Offline: {
    offline: true,
    downloadThroughput: 0,
    uploadThroughput: 0,
    latency: 0,
  },
  'Slow 3G': {
    offline: false,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
    latency: 2000,
  },
  'Fast 3G': {
    offline: false,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 562.5,
  },
  'Slow 4G': {
    offline: false,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 150,
  },
  'Fast 4G': {
    offline: false,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (9 * 1024 * 1024) / 8,
    latency: 60,
  },
  '4G': {
    offline: false,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (9 * 1024 * 1024) / 8,
    latency: 170,
  },
  WiFi: {
    offline: false,
    downloadThroughput: (30 * 1024 * 1024) / 8,
    uploadThroughput: (15 * 1024 * 1024) / 8,
    latency: 2,
  },
};

export interface EmulationStateTracker {
  setNetworkConditions?(conditions: string | null): void;
  setCpuThrottlingRate?(rate: number): void;
}

/**
 * 统一执行单页仿真配置（参考 chrome-devtools-mcp 的 page.emulate）。
 * 每次调用覆盖全部仿真项（extraHttpHeaders 除外，仅在传入时更新或清空）。
 */
export async function applyPageEmulation(
  page: Page,
  options: EmulateOptions,
  stateTracker?: EmulationStateTracker,
): Promise<void> {
  const client = await getPersistentCdpSession(page);

  // 1. 网络条件
  if (
    !options.networkConditions ||
    options.networkConditions === 'No emulation'
  ) {
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    stateTracker?.setNetworkConditions?.(null);
  } else {
    const spec = PREDEFINED_NETWORK_CONDITIONS[options.networkConditions];
    if (!spec) {
      throw new Error(
        `Unknown network condition "${options.networkConditions}". Supported: ${Object.keys(PREDEFINED_NETWORK_CONDITIONS).join(', ')}.`,
      );
    }
    await client.send('Network.emulateNetworkConditions', {...spec});
    stateTracker?.setNetworkConditions?.(options.networkConditions);
  }

  // 2. CPU 节流
  const cpuRate = options.cpuThrottlingRate ?? 1;
  await client.send('Emulation.setCPUThrottlingRate', {rate: cpuRate});
  stateTracker?.setCpuThrottlingRate?.(cpuRate);

  // 3. 地理位置
  if (!options.geolocation) {
    await client.send('Emulation.clearGeolocationOverride');
  } else {
    await client.send('Emulation.setGeolocationOverride', {
      latitude: options.geolocation.latitude,
      longitude: options.geolocation.longitude,
      accuracy: options.geolocation.accuracy ?? 1,
    });
  }

  // 4. User-Agent
  await client.send('Network.setUserAgentOverride', {
    userAgent: options.userAgent ?? '',
  });

  // 5. CSS Media Features (colorScheme / forcedColors / prefersContrast / prefersReducedMotion)
  const features: Array<{name: string; value: string}> = [];
  if (options.colorScheme && options.colorScheme !== 'auto') {
    features.push({name: 'prefers-color-scheme', value: options.colorScheme});
  }
  if (options.forcedColors && options.forcedColors !== 'auto') {
    features.push({name: 'forced-colors', value: options.forcedColors});
  }
  if (options.prefersContrast && options.prefersContrast !== 'auto') {
    features.push({name: 'prefers-contrast', value: options.prefersContrast});
  }
  if (options.prefersReducedMotion && options.prefersReducedMotion !== 'auto') {
    features.push({
      name: 'prefers-reduced-motion',
      value: options.prefersReducedMotion,
    });
  }
  await client.send('Emulation.setEmulatedMedia', {features});

  // 6. Viewport & Touch
  if (!options.viewport) {
    await client
      .send('Emulation.clearDeviceMetricsOverride')
      .catch(() => undefined);
    await client
      .send('Emulation.setTouchEmulationEnabled', {enabled: false})
      .catch(() => undefined);
  } else {
    const vp = options.viewport;
    if (typeof page.setViewportSize === 'function') {
      await page.setViewportSize({width: vp.width, height: vp.height});
    }
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.deviceScaleFactor ?? 1,
      mobile: vp.isMobile ?? false,
      ...(vp.isLandscape
        ? {screenOrientation: {type: 'landscapePrimary', angle: 90}}
        : {}),
    });
    await client
      .send('Emulation.setTouchEmulationEnabled', {
        enabled: vp.hasTouch ?? false,
      })
      .catch(() => undefined);
  }

  // 7. Extra HTTP Headers（仅在显式提供时更新）
  if (options.extraHttpHeaders !== undefined) {
    if (typeof page.setExtraHTTPHeaders === 'function') {
      await page.setExtraHTTPHeaders(options.extraHttpHeaders);
    } else {
      await client.send('Network.enable').catch(() => undefined);
      await client.send('Network.setExtraHTTPHeaders', {
        headers: options.extraHttpHeaders,
      });
    }
  }
}
