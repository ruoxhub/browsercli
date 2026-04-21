/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {ClickAtParams, ClickAtResult} from './types.js';

export async function clickAt(
  frame: Frame,
  params: ClickAtParams,
): Promise<ClickAtResult> {
  const {selector} = params;
  const tooltype = 'click_at';
  const page = frame.page();

  try {
    const client = await page.createCDPSession();

    const coords = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Element not found: ${sel}`);
      el.scrollIntoView({block: 'center'});
      const rect = el.getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        tag: el.tagName,
        text: (el.textContent || '').slice(0, 100),
      };
    }, selector);

    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: coords.x,
      y: coords.y,
      button: 'left',
      clickCount: 1,
    });

    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: coords.x,
      y: coords.y,
      button: 'left',
      clickCount: 1,
    });

    return {
      success: true,
      message: `Real mouse click at ${selector} (${coords.x}, ${coords.y})`,
      tooltype,
      logFormat: 'json',
      data: coords,
    };
  } catch (error) {
    return {
      success: false,
      message: `ClickAt failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
      data: {x: 0, y: 0, tag: '', text: ''},
    };
  }
}