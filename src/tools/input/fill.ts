/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {FillParams, FillResult} from './types.js';

export async function fill(
  frame: Frame,
  params: FillParams,
): Promise<FillResult> {
  const {selector, value} = params;
  const tooltype = 'fill';
  const page = frame.page();

  try {
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    const isSelect = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      return el?.tagName === 'SELECT';
    }, selector);

    if (isSelect) {
      await element.selectOption(value);
    } else {
      await element.fill(value);
    }

    return {
      success: true,
      message: `Successfully filled value into element: ${selector}`,
      tooltype,
      logFormat: 'simple',
    };
  } catch (error) {
    return {
      success: false,
      message: `Fill failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}