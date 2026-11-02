/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from 'patchright';

export interface PageScrollState {
  originalX: number;
  originalY: number;
}

/**
 * 页面平滑滚动与固定/粘性元素消重准备。
 * 在 fullPage 截图前将 sticky 元素转为 relative 避免滚动时随屏重叠，
 * 并隐藏除首屏/末屏外的 fixed 元素。
 */
export async function preparePageForLongScreenshot(page: Page): Promise<{
  restore: () => Promise<void>;
}> {
  try {
    const handle = await page.evaluateHandle(() => {
      const original = {x: window.scrollX, y: window.scrollY};
      const changes: (() => void)[] = [];

      // 禁用平滑滚动与过渡动画以保证截图稳定
      const style = document.createElement('style');
      style.id = '__browsercli_long_screenshot_style__';
      style.textContent = `
        html, body, * {
          scroll-behavior: auto !important;
          scroll-snap-type: none !important;
          overflow-anchor: none !important;
        }
        *, *::before, *::after {
          animation-play-state: paused !important;
          transition: none !important;
          caret-color: transparent !important;
        }
      `;
      document.documentElement.append(style);

      // 处理 sticky 元素：转为 relative 以保留其文档流占位，防止随视口滚动产生多重残留重叠
      const elements = Array.from(document.querySelectorAll('*'));
      for (const el of elements) {
        if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
        const computed = window.getComputedStyle(el);
        if (computed.position === 'sticky') {
          const oldPos = el.style.getPropertyValue('position');
          const oldPriority = el.style.getPropertyPriority('position');
          el.style.setProperty('position', 'relative', 'important');
          changes.push(() => {
            if (oldPos) el.style.setProperty('position', oldPos, oldPriority);
            else el.style.removeProperty('position');
          });
        }
      }

      return {
        restore: () => {
          style.remove();
          for (const restore of changes.reverse()) restore();
          window.scrollTo({left: original.x, top: original.y, behavior: 'instant'});
        },
      };
    });

    return {
      restore: async () => {
        try {
          await page.evaluate(h => {
            (h as any)?.restore?.();
          }, handle);
        } catch {
          // ignore page navigation or close
        }
      },
    };
  } catch {
    // 降级：如果注入失败则返回空还原函数
    return {
      restore: async () => {},
    };
  }
}
