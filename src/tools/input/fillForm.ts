/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {FillFormParams, FillFormResult} from './types.js';

export async function fillForm(
  frame: Frame,
  params: FillFormParams,
): Promise<FillFormResult> {
  const elements = params?.elements;
  const tooltype = 'fill_form';

  if (!Array.isArray(elements) || elements.length === 0) {
    return {
      success: false,
      message: 'fill_form requires a non-empty "elements" array',
      tooltype,
      data: {filled: 0, total: 0},
    };
  }

  const page = frame.page();
  const total = elements.length;
  let filled = 0;

  try {
    for (const element of elements) {
      const el = await page.$(element.selector);
      if (el) {
        const isSelect = await page.evaluate(sel => {
          const ele = document.querySelector(sel);
          return ele?.tagName === 'SELECT';
        }, element.selector);

        if (isSelect) {
          await el.selectOption(element.value);
        } else {
          await el.fill(element.value);
        }
        filled += 1;
      }
    }

    return {
      success: true,
      message: `Successfully filled out ${filled}/${total} form elements`,
      tooltype,
      logFormat: 'simple',
      data: {filled, total},
    };
  } catch (error) {
    return {
      success: false,
      message: `FillForm failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
      data: {filled, total},
    };
  }
}