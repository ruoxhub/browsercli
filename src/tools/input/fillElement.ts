/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame, Locator} from 'patchright';

import {withOperationTimeout} from '../shared/browserRuntime.js';

const DEFAULT_FILL_TIMEOUT_MS = 10_000;

export interface FillableLocator {
  count?(): Promise<number>;
  first?(): {
    evaluate?(fn: (el: Element) => boolean): Promise<boolean>;
  };
  evaluate?(fn: (el: Element) => boolean): Promise<boolean>;
  selectOption?(value: string, options?: {timeout?: number}): Promise<unknown>;
  fill(value: string, options?: {timeout?: number}): Promise<unknown>;
}

export async function fillTargetLocator(
  locator: Locator | FillableLocator,
  value: string,
  timeoutMs = DEFAULT_FILL_TIMEOUT_MS,
): Promise<{found: boolean; isSelect: boolean}> {
  const count =
    typeof locator.count === 'function'
      ? await withOperationTimeout(locator.count(), '查找表单元素', timeoutMs)
      : 1;
  if (count === 0) return {found: false, isSelect: false};

  let isSelect = false;
  try {
    const evalTarget =
      typeof locator.first === 'function' ? locator.first() : locator;
    if (typeof evalTarget.evaluate === 'function') {
      isSelect = await withOperationTimeout(
        evalTarget.evaluate((el: Element) => el.tagName === 'SELECT'),
        '检测表单元素类型',
        timeoutMs,
      );
    }
  } catch {
    isSelect = false;
  }

  const operation: Promise<unknown> =
    isSelect && typeof locator.selectOption === 'function'
      ? locator.selectOption(value, {timeout: timeoutMs})
      : locator.fill(value, {timeout: timeoutMs});
  await withOperationTimeout(operation, '填充表单元素', timeoutMs);

  return {found: true, isSelect};
}

export async function fillElement(
  frame: Frame,
  selector: string,
  value: string,
  timeoutMs = DEFAULT_FILL_TIMEOUT_MS,
): Promise<{found: boolean; isSelect: boolean}> {
  return fillTargetLocator(frame.locator(selector), value, timeoutMs);
}
