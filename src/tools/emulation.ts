/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  applyPageEmulation,
  type EmulateOptions,
  type ForcedColors,
  type GeolocationOptions,
  PREDEFINED_NETWORK_CONDITIONS,
  type PrefersContrast,
  type PrefersReducedMotion,
  type ViewportOptions,
} from '../modules/browser/EmulationManager.js';
import {zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {definePageTool, zodTransform} from './ToolDefinition.js';

// ─── emulate.ts ──────────────────────────────────────────

const FORCED_COLORS_VALUES = ['active', 'none'] as const;

const PREFERS_CONTRAST_VALUES = [
  'more',
  'less',
  'custom',
  'no-preference',
] as const;

const PREFERS_REDUCED_MOTION_VALUES = ['reduce', 'no-preference'] as const;

const VIEWPORT_FORMAT =
  '<width>x<height>x<devicePixelRatio>[,mobile][,touch][,landscape]';

function parseGeolocation(
  arg: string | undefined,
): GeolocationOptions | undefined {
  if (!arg) {
    return undefined;
  }
  const parts = arg.split(',');
  if (parts.length !== 2) {
    throw new Error(
      `Invalid geolocation "${arg}". Expected '<latitude>,<longitude>'.`,
    );
  }
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(
      `Invalid geolocation "${arg}". Latitude must be -90..90 and longitude -180..180.`,
    );
  }
  return {latitude, longitude};
}

function parseViewport(arg: string | undefined): ViewportOptions | undefined {
  if (!arg) {
    return undefined;
  }
  const [dimensions, ...tags] = arg.split(',');
  const allowedTags = new Set(['mobile', 'touch', 'landscape']);
  for (const tag of tags) {
    if (!allowedTags.has(tag)) {
      throw new Error(
        `Invalid viewport option "${tag}". Expected "mobile", "touch", or "landscape" in '${VIEWPORT_FORMAT}'.`,
      );
    }
  }
  const dimParts = dimensions.split('x');
  if (dimParts.length !== 2 && dimParts.length !== 3) {
    throw new Error(
      `Invalid viewport dimensions "${dimensions}". Expected format '${VIEWPORT_FORMAT}'.`,
    );
  }
  const width = Number(dimParts[0]);
  const height = Number(dimParts[1]);
  const dpr = dimParts[2] !== undefined ? Number(dimParts[2]) : undefined;
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0 ||
    (dpr !== undefined && (!Number.isFinite(dpr) || dpr <= 0))
  ) {
    throw new Error(
      `Invalid viewport dimensions "${dimensions}". Width/height must be positive integers.`,
    );
  }
  return {
    width,
    height,
    ...(dpr !== undefined ? {deviceScaleFactor: dpr} : {}),
    isMobile: tags.includes('mobile'),
    isLandscape: tags.includes('landscape'),
    hasTouch: tags.includes('touch'),
  };
}

function parseExtraHttpHeaders(
  value: string | undefined,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === '') {
    return {};
  }
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object');
  }
  const record: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    record[k] = String(v);
  }
  return record;
}

const throttlingOptions: [string, ...string[]] = [
  'No emulation',
  ...Object.keys(PREDEFINED_NETWORK_CONDITIONS),
];

/**
 * 统一单页环境仿真工具（参考 chrome-devtools-mcp emulate）。
 */
export const emulate = definePageTool({
  name: 'emulate',
  description:
    'Emulates various features on the target page (network, CPU throttling, geolocation, userAgent, media features, viewport, extraHttpHeaders). Each call replaces all emulation settings (except extraHttpHeaders), so pass all desired settings in a single call.',
  annotations: {
    title: '环境仿真',
    category: ToolCategory.EMULATION,
    readOnlyHint: false,
  },
  blockedByDialog: true,
  concurrency: 'exclusive',
  schema: {
    networkConditions: zod
      .enum(throttlingOptions)
      .optional()
      .describe('Throttle network. Omit or pass "No emulation" to disable.'),
    cpuThrottlingRate: zod
      .number()
      .min(1)
      .max(20)
      .optional()
      .describe(
        'CPU slowdown factor (1-20). Omit or set to 1 to disable throttling.',
      ),
    geolocation: zod
      .string()
      .transform(zodTransform(parseGeolocation))
      .optional()
      .describe(
        'Geolocation `<latitude>,<longitude>` to emulate. Omit to clear.',
      ),
    userAgent: zod
      .string()
      .optional()
      .describe('User agent to emulate. Omit or set empty to clear.'),
    colorScheme: zod
      .enum(['dark', 'light', 'auto'])
      .optional()
      .describe('Emulate dark/light color scheme, or "auto" to reset.'),
    forcedColors: zod
      .enum([...FORCED_COLORS_VALUES, 'auto'])
      .optional()
      .describe(
        'Emulate `forced-colors` CSS media feature, or "auto" to reset.',
      ),
    prefersContrast: zod
      .enum([...PREFERS_CONTRAST_VALUES, 'auto'])
      .optional()
      .describe(
        'Emulate `prefers-contrast` CSS media feature, or "auto" to reset.',
      ),
    prefersReducedMotion: zod
      .enum([...PREFERS_REDUCED_MOTION_VALUES, 'auto'])
      .optional()
      .describe(
        'Emulate `prefers-reduced-motion` CSS media feature, or "auto" to reset.',
      ),
    viewport: zod
      .string()
      .transform(zodTransform(parseViewport))
      .optional()
      .describe(
        `Emulate viewport '${VIEWPORT_FORMAT}'. Omit to clear viewport override.`,
      ),
    extraHttpHeaders: zod
      .string()
      .transform(zodTransform(parseExtraHttpHeaders))
      .optional()
      .describe(
        'Extra HTTP headers as JSON string object, e.g. {"X-Custom": "value"}. Pass empty string to clear.',
      ),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'emulate'},
      );
    }

    let geolocation: GeolocationOptions | undefined;
    let viewport: ViewportOptions | undefined;
    let extraHttpHeaders: Record<string, string> | undefined;
    try {
      const rawGeo = request.params.geolocation as unknown;
      geolocation =
        typeof rawGeo === 'string'
          ? parseGeolocation(rawGeo)
          : (rawGeo as GeolocationOptions | undefined);
      const rawVp = request.params.viewport as unknown;
      viewport =
        typeof rawVp === 'string'
          ? parseViewport(rawVp)
          : (rawVp as ViewportOptions | undefined);
      const rawHeaders = request.params.extraHttpHeaders as unknown;
      extraHttpHeaders =
        typeof rawHeaders === 'string'
          ? parseExtraHttpHeaders(rawHeaders)
          : (rawHeaders as Record<string, string> | undefined);
    } catch (error) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        `环境仿真参数无效：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'emulate'},
      );
    }

    const options: EmulateOptions = {
      networkConditions: request.params.networkConditions,
      cpuThrottlingRate: request.params.cpuThrottlingRate,
      geolocation,
      userAgent: request.params.userAgent,
      colorScheme: request.params.colorScheme as
        | 'dark'
        | 'light'
        | 'auto'
        | undefined,
      forcedColors: request.params.forcedColors as
        | ForcedColors
        | 'auto'
        | undefined,
      prefersContrast: request.params.prefersContrast as
        | PrefersContrast
        | 'auto'
        | undefined,
      prefersReducedMotion: request.params.prefersReducedMotion as
        | PrefersReducedMotion
        | 'auto'
        | undefined,
      viewport,
      extraHttpHeaders,
    };

    try {
      if (context.emulate) {
        await context.emulate(options);
      } else {
        await applyPageEmulation(page, options, {
          setNetworkConditions: c => context.setNetworkConditions(c),
          setCpuThrottlingRate: r => context.setCpuThrottlingRate(r),
        });
      }

      response.appendResponseLine('Emulation configured successfully');
      response.setStructuredContent({
        success: true,
        message: 'Emulation configured successfully',
        tooltype: 'emulate',
        data: options,
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `环境仿真配置失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'emulate'},
      );
    }
  },
});

// ─── resizePage.ts ───────────────────────────────────────

/**
 * 调整页面窗口尺寸。
 */
export const resizePage = definePageTool({
  name: 'resize_page',
  description: '将页面视口调整为指定的宽度与高度。',
  annotations: {category: ToolCategory.EMULATION, readOnlyHint: false},
  schema: {
    width: zod
      .number()
      .int()
      .min(1)
      .max(10000)
      .describe('视口宽度（像素），1-10000 的整数。'),
    height: zod
      .number()
      .int()
      .min(1)
      .max(10000)
      .describe('视口高度（像素），1-10000 的整数。'),
  },
  handler: async (request, response, context) => {
    const {width, height} = request.params;
    const tooltype = 'resize_page';
    const frame = context.getSelectedFrame();
    const page = frame.page();

    try {
      await page.setViewportSize({width, height});
      response.setStructuredContent({
        success: true,
        message: `页面尺寸已调整为 ${width}x${height}`,
        tooltype,
        data: {width, height},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `页面尺寸调整失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'resize_page', width, height},
      );
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'emulation',
  description: 'Device, network, and viewport emulation tools.',
  profile: 'full',
  tools: [
    {modulePath: './emulation.js', handlerName: 'emulate'},
    {modulePath: './emulation.js', handlerName: 'resizePage'},
  ],
} satisfies DomainManifest;
