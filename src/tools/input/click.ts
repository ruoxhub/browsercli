/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {ClickParams, ClickResult} from './types.js';

export async function click(
  frame: Frame,
  params: ClickParams,
): Promise<ClickResult> {
  const {selector, dblClick = false} = params;
  const tooltype = 'click';
  const page = frame.page();

  try {
    await page.click(selector, {clickCount: dblClick ? 2 : 1});
    return {
      success: true,
      message: `Successfully ${dblClick ? 'double ' : ''}clicked on element: ${selector}`,
      tooltype,
      logFormat: 'simple',
    };
  } catch (error) {
    return {
      success: false,
      message: `Click failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}