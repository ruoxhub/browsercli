/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {DragParams, DragResult} from './types.js';

export async function drag(
  frame: Frame,
  params: DragParams,
): Promise<DragResult> {
  const {fromSelector, toSelector} = params;
  const tooltype = 'drag';
  const page = frame.page();

  try {
    const fromElement = await page.$(fromSelector);
    const toElement = await page.$(toSelector);

    if (!fromElement) {
      throw new Error(`Source element not found: ${fromSelector}`);
    }
    if (!toElement) {
      throw new Error(`Target element not found: ${toSelector}`);
    }

    const fromBox = await fromElement.boundingBox();
    const toBox = await toElement.boundingBox();

    if (!fromBox || !toBox) {
      throw new Error('Element bounding box not available');
    }

    const fromX = fromBox.x + fromBox.width / 2;
    const fromY = fromBox.y + fromBox.height / 2;
    const toX = toBox.x + toBox.width / 2;
    const toY = toBox.y + toBox.height / 2;

    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(toX, toY);
    await page.mouse.up();

    return {
      success: true,
      message: `Successfully dragged element from ${fromSelector} to ${toSelector}`,
      tooltype,
      logFormat: 'simple',
    };
  } catch (error) {
    return {
      success: false,
      message: `Drag failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}