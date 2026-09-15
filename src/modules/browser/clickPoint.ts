/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 点击落点解析：CDP 四层降级，优先返回元素实际可见区域的中心。
 *
 * 1. locator.scrollIntoViewIfNeeded() — 确保滚入视口，防止被截断误触
 * 2. 通过 ElementHandle 获取 CDP objectId — 原生支持所有定位器（CSS/role/text/xpath）
 * 3. DOM.getContentQuads — 选视口内最大可见 quad
 * 4. DOM.getBoxModel    — 降级 content 八元组
 * 5. getBoundingClientRect — 降级 JS 矩形
 * 6. 全部失败           — 返回 jsClick
 */

import type {CDPSession, Frame} from '../../third_party/index.js';

import {withCdpSession} from './cdpUtils.js';

export type ClickSource = 'contentQuads' | 'boxModel' | 'boundingRect';

export type ClickResolution =
  | {
      kind: 'point';
      x: number;
      y: number;
      source: ClickSource;
      quadCount: number;
    }
  | {kind: 'jsClick'};

export interface Viewport {
  width: number;
  height: number;
}

type Quad = number[];

function quadCenter(quad: Quad): {x: number; y: number} {
  let x = 0;
  let y = 0;
  let count = 0;
  for (let i = 0; i + 1 < quad.length; i += 2) {
    x += quad[i];
    y += quad[i + 1];
    count += 1;
  }
  if (count === 0) return {x: 0, y: 0};
  return {x: x / count, y: y / count};
}

function quadBounds(quad: Quad): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < quad.length; i += 2) {
    xs.push(quad[i]);
    ys.push(quad[i + 1]);
  }
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function visibleArea(quad: Quad, viewport: Viewport): number {
  const {minX, minY, maxX, maxY} = quadBounds(quad);
  if (viewport.width <= 0 || viewport.height <= 0) {
    return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  }
  const width = Math.min(viewport.width, maxX) - Math.max(0, minX);
  const height = Math.min(viewport.height, maxY) - Math.max(0, minY);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function clamp(value: number, max: number): number {
  if (max <= 0) return Math.max(0, value);
  return Math.max(0, Math.min(max - 1, value));
}

/**
 * 原生遮挡判定：用 document.elementFromPoint 检查 quad 中心是否被其他顶层元素覆盖。
 * 任一环节失败（跨 iframe、evaluate 异常等）时按未遮挡处理，保持降级语义。
 */
async function isQuadTopmost(
  handle: any,
  x: number,
  y: number,
): Promise<boolean> {
  try {
    return await handle.evaluate(
      (el: Element, point: {x: number; y: number}) => {
        const topEl = document.elementFromPoint(point.x, point.y);
        if (!topEl) return true;
        return el === topEl || el.contains(topEl) || topEl.contains(el);
      },
      {x, y},
    );
  } catch {
    return true;
  }
}

async function readViewport(client: CDPSession): Promise<Viewport> {
  try {
    const metrics = await client.send('Page.getLayoutMetrics', {});
    const viewport = metrics.cssLayoutViewport;
    return {
      width: viewport?.clientWidth ?? 0,
      height: viewport?.clientHeight ?? 0,
    };
  } catch {
    return {width: 0, height: 0};
  }
}

export async function resolveClickPoint(
  frame: Frame,
  selector: string,
  options?: {viewport?: Viewport},
): Promise<ClickResolution> {
  const locator = frame.locator(selector);

  // 1. 强制滚动入视口，防止被视口 clamp 截断点偏
  try {
    await locator.scrollIntoViewIfNeeded({timeout: 3000});
  } catch {
    // 滚动超时或失败不直接打断，继续尝试获取 handle
  }

  let handle: any;
  try {
    handle = await locator.elementHandle({timeout: 3000});
  } catch {
    return {kind: 'jsClick'};
  }
  if (!handle) return {kind: 'jsClick'};

  const objectId = handle._remoteObject?.()?.objectId;

  return await withCdpSession(frame.page(), async client => {
    const viewport = options?.viewport ?? (await readViewport(client));

    if (objectId) {
      // 2. 优先尝试 DOM.getContentQuads
      try {
        const response = await client.send('DOM.getContentQuads', {objectId});
        const quads = response.quads ?? [];
        if (quads.length > 0) {
          // 按可见面积从大到小排序
          const sorted = [...quads].sort(
            (a, b) => visibleArea(b, viewport) - visibleArea(a, viewport),
          );

          // 寻找第一个未被遮挡的 quad
          let chosen = sorted[0];
          for (const candidate of sorted) {
            const center = quadCenter(candidate);
            const topmost = await isQuadTopmost(handle, center.x, center.y);
            if (topmost) {
              chosen = candidate;
              break;
            }
          }

          const center = quadCenter(chosen);
          return {
            kind: 'point',
            x: clamp(center.x, viewport.width),
            y: clamp(center.y, viewport.height),
            source: 'contentQuads',
            quadCount: quads.length,
          };
        }
      } catch {
        // 继续降级到 boxModel
      }

      // 3. 降级 DOM.getBoxModel
      try {
        const model = await client.send('DOM.getBoxModel', {objectId});
        const content = model.model?.content;
        if (content && content.length >= 8) {
          const center = quadCenter(content);
          return {
            kind: 'point',
            x: clamp(center.x, viewport.width),
            y: clamp(center.y, viewport.height),
            source: 'boxModel',
            quadCount: 1,
          };
        }
      } catch {
        // 继续降级到 boundingRect
      }
    }

    // 4. 降级 getBoundingClientRect
    try {
      const rect = await handle.evaluate((el: Element) => {
        const r = el.getBoundingClientRect();
        return {x: r.left, y: r.top, width: r.width, height: r.height};
      });
      if (rect) {
        return {
          kind: 'point',
          x: clamp(rect.x + rect.width / 2, viewport.width),
          y: clamp(rect.y + rect.height / 2, viewport.height),
          source: 'boundingRect',
          quadCount: 0,
        };
      }
    } catch {
      // 失败转 jsClick
    }

    return {kind: 'jsClick'};
  });
}
