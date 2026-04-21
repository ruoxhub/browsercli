/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {PressKeyParams, PressKeyResult} from './types.js';
import {parseKey} from '../../utils/keyboard.js';

export async function pressKey(
  frame: Frame,
  params: PressKeyParams,
): Promise<PressKeyResult> {
  const {key} = params;
  const tooltype = 'press_key';
  const page = frame.page();

  try {
    const tokens = parseKey(key);
    const [mainKey, ...modifiers] = tokens;

    for (const modifier of modifiers) {
      await page.keyboard.down(modifier);
    }
    await page.keyboard.press(mainKey);
    for (const modifier of modifiers.toReversed()) {
      await page.keyboard.up(modifier);
    }

    return {
      success: true,
      message: `Successfully pressed key: ${key}`,
      tooltype,
      logFormat: 'simple',
    };
  } catch (error) {
    return {
      success: false,
      message: `PressKey failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}