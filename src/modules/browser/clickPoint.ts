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
 * 4. getBoundingClientRect()          — 降级整体包围盒，零面积视为无效落点
 * 5. 全部失败                         — 返回 jsClick
 *
 * 视口尺寸在页内取 window.innerWidth/innerHeight，与 CDP Input.dispatchMouseEvent 的
 * CSS 像素坐标系一致，不需要额外的 CDP 往返。
 */

import type {ElementHandle, Frame} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';

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

function clamp(value: number, max: number): number {
  if (max <= 0) return Math.max(0, value);
  return Math.max(0, Math.min(max - 1, value));
}

export async function resolveClickPoint(
  frame: Frame,
  selector: string,
): Promise<ClickResolution> {
  const locator = frame.locator(selector);

  // 1. 强制滚动入视口，防止被视口 clamp 截断点偏
  try {
    await locator.scrollIntoViewIfNeeded({timeout: 3000});
  } catch (error) {
    // 滚动超时或失败不直接打断，继续尝试获取 handle
    logger.debug(
      `resolveClickPoint: scrollIntoViewIfNeeded failed for ${selector}`,
      error,
    );
  }

  let handle: ElementHandle | null = null;
  try {
    handle = await locator.elementHandle({timeout: 3000});
  } catch (error) {
    logger.debug(
      `resolveClickPoint: elementHandle failed for ${selector}`,
      error,
    );
    return {kind: 'jsClick'};
  }
  if (!handle) return {kind: 'jsClick'};

  // 2. 尝试 getClientRects + 遮挡判定
  try {
    const geom = await handle.evaluate(
      (el: Element): {x: number; y: number; count: number} | null => {
        const rawRects = Array.from(el.getClientRects());
        const rects = rawRects.filter(r => r.width > 0 && r.height > 0);
        if (rects.length === 0) return null;

        // 该回调只在真实页面/iframe 内执行，window/document 必然存在
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;

        const visibleArea = (r: DOMRect) => {
          const w =
            (vpW > 0 ? Math.min(vpW, r.right) : r.right) - Math.max(0, r.left);
          const h =
            (vpH > 0 ? Math.min(vpH, r.bottom) : r.bottom) - Math.max(0, r.top);
          return w > 0 && h > 0 ? w * h : 0;
        };

        // 页内执行无法引用模块级 clamp，此处行为必须与之保持一致
        const clampVal = (val: number, max: number) => {
          if (max <= 0) return Math.max(0, val);
          return Math.max(0, Math.min(max - 1, val));
        };

        // 面积降序后取首个未被遮挡的 rect；全部被遮挡时退回面积最大者。
        const scored = rects.map(r => ({rect: r, area: visibleArea(r)}));
        scored.sort((a, b) => b.area - a.area);
        let chosen = scored[0].rect;
        for (const item of scored) {
          const r = item.rect;
          const topEl = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          const unobscured =
            topEl === null ||
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
  } catch (error) {
    logger.debug(
      `resolveClickPoint: getClientRects resolution failed for ${selector}`,
      error,
    );
  }

  // 3. 降级 getBoundingClientRect（视口上限同样在页内取，避免 clamp 退化为无上界）
  try {
    const rect = await handle.evaluate((el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    // 零面积（display:none / 已脱离布局）不是有效落点，否则会点到视口左上角。
    if (rect && rect.width > 0 && rect.height > 0) {
      return {
        kind: 'point',
        x: clamp(rect.x + rect.width / 2, rect.viewportWidth),
        y: clamp(rect.y + rect.height / 2, rect.viewportHeight),
        source: 'boundingRect',
        quadCount: 0,
      };
    }
  } catch (error) {
    logger.debug(
      `resolveClickPoint: getBoundingClientRect fallback failed for ${selector}`,
      error,
    );
  }

  return {kind: 'jsClick'};
}
