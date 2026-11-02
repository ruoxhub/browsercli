/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from 'patchright';

/**
 * 常见自变动（Volatile）节点模式：
 * 广告轮播、时钟时间戳、自增计数器、轮询通知气泡、媒体进度条等。
 * 这些节点的文本或属性变动属于良性噪声，不代表页面主结构破坏。
 */
export const VOLATILE_SELECTORS = [
  '[data-volatile]',
  '.timer',
  '.clock',
  '.counter',
  '.carousel',
  '.notification-badge',
  '.live-ticker',
  'video',
  'audio',
  'progress',
  '[aria-live="polite"]',
];

export interface MutationSnapshot {
  structureHash: number;
  interactiveCount: number;
  timestamp: number;
}

export class ActionGuard {
  /**
   * 判断一个元素变动是否属于自变动噪声。
   */
  static isVolatileElement(element: {
    tagName?: string;
    className?: string;
    id?: string;
    attributes?: Record<string, string>;
  }): boolean {
    const tag = (element.tagName ?? '').toLowerCase();
    if (tag === 'video' || tag === 'audio' || tag === 'progress') {
      return true;
    }

    const cls = (element.className ?? '').toLowerCase();
    if (
      cls.includes('timer') ||
      cls.includes('clock') ||
      cls.includes('counter') ||
      cls.includes('carousel') ||
      cls.includes('live') ||
      cls.includes('badge')
    ) {
      return true;
    }

    const attrs = element.attributes ?? {};
    if (attrs['aria-live'] === 'polite' || attrs['data-volatile'] !== undefined) {
      return true;
    }

    return false;
  }

  /**
   * 采集页面结构关键指纹（过滤 volatile 元素噪声）。
   */
  static async captureStructureSignature(page: Page): Promise<MutationSnapshot> {
    try {
      const result = await page.evaluate(volatilePatterns => {
        const isVolatile = (el: Element): boolean => {
          const tag = el.tagName.toLowerCase();
          if (tag === 'video' || tag === 'audio' || tag === 'progress') return true;
          const cls = el.className;
          if (typeof cls === 'string') {
            const lower = cls.toLowerCase();
            if (
              lower.includes('timer') ||
              lower.includes('clock') ||
              lower.includes('counter') ||
              lower.includes('carousel') ||
              lower.includes('live') ||
              lower.includes('badge')
            ) {
              return true;
            }
          }
          if (el.getAttribute('aria-live') === 'polite' || el.hasAttribute('data-volatile')) {
            return true;
          }
          return false;
        };

        // 统计页面非自变动的可交互与主体元素结构
        const all = Array.from(document.querySelectorAll('button, a, input, select, textarea, dialog, [role="button"], [role="dialog"]'));
        let count = 0;
        let str = '';

        for (const el of all) {
          if (isVolatile(el)) continue;
          count++;
          str += `${el.tagName}:${el.id || ''}:${el.getAttribute('role') || ''};`;
        }

        // 简易 FNV-1a hash
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
          hash ^= str.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }

        return {
          structureHash: hash,
          interactiveCount: count,
          timestamp: Date.now(),
        };
      }, VOLATILE_SELECTORS);

      return result;
    } catch {
      return {
        structureHash: 0,
        interactiveCount: 0,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 校验页面在动作执行前是否发生了破坏性主结构变迁（而非自变动噪声）。
   * 若结构差异过大，返回 false 说明页面已被重写或跳转。
   */
  static verifyStability(before: MutationSnapshot, after: MutationSnapshot): boolean {
    if (before.structureHash === 0 || after.structureHash === 0) return true;
    if (before.structureHash === after.structureHash) return true;

    // 交互控件数量变动超过 50% 视为发生剧烈结构重排
    const countDiff = Math.abs(before.interactiveCount - after.interactiveCount);
    if (before.interactiveCount > 0 && countDiff / before.interactiveCount > 0.5) {
      return false;
    }

    return true;
  }
}
