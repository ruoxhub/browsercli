/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from 'patchright';

import {withOperationTimeout} from '../shared/browserRuntime.js';

const DEFAULT_FILL_TIMEOUT_MS = 10_000;

export async function fillElement(
  frame: Frame,
  selector: string,
  value: string,
  timeoutMs = DEFAULT_FILL_TIMEOUT_MS,
): Promise<{found: boolean; isSelect: boolean}> {
  const locator = frame.locator(selector);
  const count = await withOperationTimeout(
    locator.count(),
    '查找表单元素',
    timeoutMs,
  );
  if (count === 0) return {found: false, isSelect: false};

  const isSelect = await withOperationTimeout(
    locator.first().evaluate((el: Element) => el.tagName === 'SELECT'),
    '检测表单元素类型',
    timeoutMs,
  );
  const operation: Promise<unknown> = isSelect
    ? locator.selectOption(value, {timeout: timeoutMs})
    : locator.fill(value, {timeout: timeoutMs});
  await withOperationTimeout(operation, '填充表单元素', timeoutMs);

  return {found: true, isSelect};
}
