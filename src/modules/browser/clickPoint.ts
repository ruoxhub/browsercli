/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 点击落点解析：页内原生几何三层降级，优先返回元素实际可见区域的中心。
 *
 * 1. locator.scrollIntoViewIfNeeded() — 确保滚入视口，防止被截断误触
 * 2. locator.elementHandle()          — 原生支持所有定位器（CSS/role/text/xpath）
 * 3. getClientRects()                 — 视口内最大可见 rect，结合 elementFromPoint 避开遮挡
 * 4. getBoundingClientRect()          — 降级整体包围盒
 * 5. 全部失败                         — 返回 jsClick
 */

import type {ElementHandle, Frame} from '../../third_party/index.js';

export type ClickSource = 'clientRects' | 'boundingRect';

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

function clamp(value: number, max: number): number {
  if (max <= 0) return Math.max(0, value);
  return Math.max(0, Math.min(max - 1, value));
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

  let handle: ElementHandle | null = null;
  try {
    handle = await locator.elementHandle({timeout: 3000});
  } catch {
    return {kind: 'jsClick'};
  }
  if (!handle) return {kind: 'jsClick'};

  // 2. 尝试 getClientRects + 遮挡判定
  try {
    const geom = await handle.evaluate(
      (
        el: Element,
        opts: {viewport?: Viewport},
      ): {x: number; y: number; count: number} | null => {
        const rawRects = Array.from(el.getClientRects());
        const rects = rawRects.filter(r => r.width > 0 && r.height > 0);
        if (rects.length === 0) return null;

        const win = typeof window !== 'undefined' ? window : undefined;
        const doc = typeof document !== 'undefined' ? document : undefined;
        const vpW =
          opts.viewport?.width && opts.viewport.width > 0
            ? opts.viewport.width
            : (win?.innerWidth ?? 0);
        const vpH =
          opts.viewport?.height && opts.viewport.height > 0
            ? opts.viewport.height
            : (win?.innerHeight ?? 0);

        const visibleArea = (r: {
          left: number;
          top: number;
          right?: number;
          bottom?: number;
          width: number;
          height: number;
        }) => {
          const right = r.right !== undefined ? r.right : r.left + r.width;
          const bottom = r.bottom !== undefined ? r.bottom : r.top + r.height;
          const w =
            (vpW > 0 ? Math.min(vpW, right) : right) - Math.max(0, r.left);
          const h =
            (vpH > 0 ? Math.min(vpH, bottom) : bottom) - Math.max(0, r.top);
          return w > 0 && h > 0 ? w * h : 0;
        };

        const scored = rects.map(r => ({rect: r, area: visibleArea(r)}));
        scored.sort((a, b) => b.area - a.area);

        const clampVal = (val: number, max: number) => {
          if (max <= 0) return Math.max(0, val);
          return Math.max(0, Math.min(max - 1, val));
        };

        let chosen = scored[0].rect;
        for (const item of scored) {
          const r = item.rect;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const topEl = doc?.elementFromPoint?.(cx, cy);
          const unobscured =
            topEl == null ||
            el === topEl ||
            Boolean(el.contains && el.contains(topEl as Node));
          if (unobscured) {
            chosen = r;
            break;
          }
        }

        const rawX = chosen.left + chosen.width / 2;
        const rawY = chosen.top + chosen.height / 2;
        return {
          x: clampVal(rawX, vpW),
          y: clampVal(rawY, vpH),
          count: rects.length,
        };
      },
      {viewport: options?.viewport},
    );

    if (geom) {
      return {
        kind: 'point',
        x: geom.x,
        y: geom.y,
        source: 'clientRects',
        quadCount: geom.count,
      };
    }
  } catch {
    // 降级到 boundingRect
  }

  // 3. 降级 getBoundingClientRect
  try {
    const rect = await handle.evaluate((el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left ?? r.x ?? 0,
        y: r.top ?? r.y ?? 0,
        width: r.width ?? 0,
        height: r.height ?? 0,
      };
    });
    if (rect) {
      const vpW = options?.viewport?.width ?? 0;
      const vpH = options?.viewport?.height ?? 0;
      return {
        kind: 'point',
        x: clamp(rect.x + rect.width / 2, vpW),
        y: clamp(rect.y + rect.height / 2, vpH),
        source: 'boundingRect',
        quadCount: 0,
      };
    }
  } catch {
    // 失败转 jsClick
  }

  return {kind: 'jsClick'};
}
