/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {HoverParams, HoverResult} from './types.js';

export async function hover(
  frame: Frame,
  params: HoverParams,
): Promise<HoverResult> {
  const {selector} = params;
  const tooltype = 'hover';
  const page = frame.page();

  try {
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    await element.hover();
    return {
      success: true,
      message: `Successfully hovered over element: ${selector}`,
      tooltype,
      logFormat: 'simple',
    };
  } catch (error) {
    return {
      success: false,
      message: `Hover failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}