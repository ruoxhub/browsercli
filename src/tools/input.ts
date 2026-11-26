/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame, Locator} from 'patchright';

import {withCdpSession} from '../modules/browser/cdpUtils.js';
import {resolveClickPoint} from '../modules/browser/clickPoint.js';
import type {WaitForEventsOptions} from '../modules/browser/WaitForHelper.js';
import {zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';
import {parseKey} from '../utils/keyboard.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {NO_ACTIVE_PAGE_MESSAGE} from './shared/activePageResolver.js';
import {
  browserTimeoutSchema,
  withDebuggerTrapBypass,
  withOperationTimeout,
} from './shared/browserRuntime.js';
import {
  classifyElementError,
  resolveTargetLocator,
  toElementError,
} from './shared/elementLocator.js';
import {type Context, definePageTool, type Response} from './ToolDefinition.js';

// ─── fillElement.ts ──────────────────────────────────────

const DEFAULT_FILL_TIMEOUT_MS = 10_000;

export interface FillableLocator {
  count?(): Promise<number>;
  first?(): {
    evaluate?(fn: (el: Element) => unknown): Promise<unknown>;
  };
  evaluate?(fn: (el: Element) => unknown): Promise<unknown>;
  selectOption?(value: string, options?: {timeout?: number}): Promise<unknown>;
  setChecked?(checked: boolean, options?: {timeout?: number}): Promise<unknown>;
  fill(value: string, options?: {timeout?: number}): Promise<unknown>;
}

interface DetectedControlKind {
  isSelect: boolean;
  isToggle: boolean;
}

function parseBooleanValue(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'checked'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off', 'unchecked'].includes(normalized)) {
    return false;
  }
  return undefined;
}

export async function fillTargetLocator(
  locator: Locator | FillableLocator,
  value: string,
  timeoutMs = DEFAULT_FILL_TIMEOUT_MS,
): Promise<{found: boolean; isSelect: boolean; isToggle?: boolean}> {
  const count =
    typeof locator.count === 'function'
      ? await withOperationTimeout(locator.count(), '查找表单元素', timeoutMs)
      : 1;
  if (count === 0) return {found: false, isSelect: false};

  let controlKind: DetectedControlKind = {isSelect: false, isToggle: false};
  try {
    const evalTarget =
      typeof locator.first === 'function' ? locator.first() : locator;
    if (typeof evalTarget.evaluate === 'function') {
      const raw = await withOperationTimeout(
        (
          evalTarget.evaluate as (
            fn: (el: Element) => unknown,
          ) => Promise<unknown>
        )((el: Element): DetectedControlKind | boolean => {
          const tag = el.tagName.toUpperCase();
          if (tag === 'SELECT') {
            return {isSelect: true, isToggle: false};
          }
          const role = el.getAttribute('role')?.toLowerCase();
          const inputType =
            tag === 'INPUT'
              ? ((el as HTMLInputElement).type || '').toLowerCase()
              : '';
          if (
            inputType === 'checkbox' ||
            inputType === 'radio' ||
            role === 'checkbox' ||
            role === 'switch' ||
            role === 'radio'
          ) {
            return {isSelect: false, isToggle: true};
          }
          return {isSelect: false, isToggle: false};
        }),
        '检测表单元素类型',
        timeoutMs,
      );
      if (typeof raw === 'boolean') {
        controlKind = {isSelect: raw, isToggle: false};
      } else if (raw && typeof raw === 'object') {
        controlKind = raw as DetectedControlKind;
      }
    }
  } catch {
    controlKind = {isSelect: false, isToggle: false};
  }

  const desiredChecked = controlKind.isToggle
    ? parseBooleanValue(value)
    : undefined;

  let operation: Promise<unknown>;
  if (controlKind.isSelect && typeof locator.selectOption === 'function') {
    operation = locator.selectOption(value, {timeout: timeoutMs});
  } else if (
    controlKind.isToggle &&
    desiredChecked !== undefined &&
    typeof locator.setChecked === 'function'
  ) {
    operation = locator.setChecked(desiredChecked, {timeout: timeoutMs});
  } else {
    operation = locator.fill(value, {timeout: timeoutMs});
  }
  await withOperationTimeout(operation, '填充表单元素', timeoutMs);

  return {
    found: true,
    isSelect: controlKind.isSelect,
    ...(controlKind.isToggle ? {isToggle: true} : {}),
  };
}

export async function fillElement(
  frame: Frame,
  selector: string,
  value: string,
  timeoutMs = DEFAULT_FILL_TIMEOUT_MS,
): Promise<{found: boolean; isSelect: boolean}> {
  return fillTargetLocator(frame.locator(selector), value, timeoutMs);
}

// ─── inputHelpers.ts ─────────────────────────────────────

export interface InputActionOptions {
  includeSnapshot?: boolean;
  waitOptions?: WaitForEventsOptions;
}

/**
 * 在交互工具中统一挂载事件等待（导航/弹窗/新页面）与可选响应快照。
 * 若测试环境注入的精简 Context Mock 未实现 `waitForEventsAfterAction`，
 * 则直接执行 action 并保持向后兼容。
 */
export async function runInputAction<T>(
  context: Context,
  response: Response,
  action: () => Promise<T>,
  options: InputActionOptions = {},
): Promise<T> {
  let result!: T;
  let dialogOpened: {type: string; message: string} | undefined;

  if (typeof context.waitForEventsAfterAction === 'function') {
    const waitResult = await context.waitForEventsAfterAction(async () => {
      result = await action();
    }, options.waitOptions);
    if (waitResult && response.attachWaitForResult) {
      response.attachWaitForResult(waitResult);
    }
    if (waitResult && typeof waitResult === 'object' && waitResult.dialogOpened) {
      dialogOpened = waitResult.dialogOpened;
      response.appendResponseLine?.(
        `Action triggered a "${dialogOpened.type}" dialog ("${dialogOpened.message}"). Call handle_dialog to accept or dismiss it.`,
      );
    }
  } else {
    result = await action();
  }

  if (options.includeSnapshot && response.includeSnapshot && !dialogOpened) {
    response.includeSnapshot();
  }

  return result;
}

// ─── click.ts ────────────────────────────────────────────

const DEFAULT_CLICK_TIMEOUT_MS = 10_000;

/**
 * 点击页面元素，支持单击和双击。支持 uid 与 selector 双模定位。
 */
export const click = definePageTool({
  name: 'click',
  description:
    '点击页面元素，支持单击与双击。支持由 take_snapshot 产生的 uid（推荐）或传统定位器（CSS、role=、text=、xpath=）。',
  annotations: {
    title: '点击元素',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
    requirements: {
      browser: 'connected',
      page: 'selected',
      frame: 'selected',
      debugger: 'running',
    },
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    uid: zod
      .string()
      .optional()
      .describe(
        '由 take_snapshot 返回的元素唯一编号，如 "1_4"。推荐优先使用，稳定且免疫动态 Class 混淆。',
      ),
    selector: zod
      .string()
      .optional()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。当未提供 uid 时必填。多匹配时用 >> nth=N 消歧。',
      ),
    dblClick: zod.boolean().optional().describe('是否双击，默认 false。'),
    includeSnapshot: zod
      .boolean()
      .optional()
      .describe('点击完成后是否附带最新页面无障碍树快照（默认 false）。'),
    timeoutMs: browserTimeoutSchema('页面操作超时（毫秒，默认 10000）。'),
  },
  handler: async (request, response, context) => {
    const {
      uid,
      selector,
      dblClick = false,
      includeSnapshot,
      timeoutMs = DEFAULT_CLICK_TIMEOUT_MS,
    } = request.params;

    let resolvedDescription = selector || (uid ? `uid=${uid}` : '');

    try {
      const targetDescription =
        (await runInputAction(
          context,
          response,
          () =>
            withDebuggerTrapBypass(context, async () => {
              const {locator, targetDescription} = resolveTargetLocator(
                context,
                {
                  uid,
                  selector,
                  toolName: 'click',
                },
              );
              resolvedDescription = targetDescription;
              await withOperationTimeout(
                locator.click({
                  clickCount: dblClick ? 2 : 1,
                  timeout: timeoutMs,
                }),
                '点击页面元素',
                timeoutMs,
              );
              return targetDescription;
            }),
          {includeSnapshot},
        )) ?? resolvedDescription;
      response.setStructuredContent({
        success: true,
        message: `Successfully ${dblClick ? 'double ' : ''}clicked on element: ${targetDescription}`,
        tooltype: 'click',
        data: {
          selector,
          ...(uid !== undefined ? {uid} : {}),
          dblClick,
        },
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'click',
        selector,
        uid,
        target: resolvedDescription,
        dblClick,
      });
    }
  },
});

// ─── clickAt.ts ──────────────────────────────────────────

async function dispatchCdpClick(
  page: Parameters<typeof withCdpSession>[0],
  x: number,
  y: number,
  dblClick: boolean,
): Promise<void> {
  const clickCount = dblClick ? 2 : 1;
  await withCdpSession(page, async client => {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount,
    });
  });
}

/**
 * 通过 CDP 在页面坐标或元素坐标处派发真实鼠标点击事件。
 */
export const clickAt = definePageTool({
  name: 'click_at',
  description:
    '使用 CDP Input.dispatchMouseEvent 在指定视口坐标 (x, y) 或元素 (uid/selector) 中心处派发真实鼠标点击事件，适用于 Canvas 或普通点击被拦截的场景。',
  annotations: {
    title: '坐标点击',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    x: zod
      .number()
      .optional()
      .describe('视口 X 坐标（像素，与 y 成对传入以直接按坐标点击）。'),
    y: zod
      .number()
      .optional()
      .describe('视口 Y 坐标（像素，与 x 成对传入以直接按坐标点击）。'),
    uid: zod
      .string()
      .optional()
      .describe('由 take_snapshot 返回的元素唯一编号（可选）。'),
    selector: zod
      .string()
      .optional()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。',
      ),
    dblClick: zod.boolean().optional().describe('是否双击，默认 false。'),
    includeSnapshot: zod
      .boolean()
      .optional()
      .describe('点击完成后是否附带最新页面无障碍树快照（默认 false）。'),
  },
  handler: async (request, response, context) => {
    const {
      x,
      y,
      uid,
      selector,
      dblClick = false,
      includeSnapshot,
    } = request.params;
    const ctx = context as Context;
    const hasX = x !== undefined;
    const hasY = y !== undefined;

    if (hasX !== hasY) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'x 与 y 坐标必须成对提供。',
        {toolName: 'click_at', x, y},
      );
    }

    if (!hasX && !uid && !selector) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        '必须提供 (x, y) 坐标、uid 或 selector 中的至少一种定位方式。',
        {toolName: 'click_at'},
      );
    }

    try {
      await runInputAction(
        ctx,
        response,
        async () => {
          if (hasX && hasY) {
            const page =
              ctx.getSelectedPage?.() ?? ctx.getSelectedFrame?.()?.page();
            if (!page) {
              throw createToolError(
                ErrorCodes.PAGE_REQUIRED,
                '当前没有活动页面，无法执行坐标点击。',
                {toolName: 'click_at'},
              );
            }
            await dispatchCdpClick(page, x, y, dblClick);
            response.setStructuredContent({
              success: true,
              message: `Real mouse click at (${x}, ${y})`,
              tooltype: 'click_at',
              data: {
                x,
                y,
                dblClick,
                tag: '',
                text: '',
                source: 'coordinates',
              },
            });
            return;
          }

          if (uid) {
            const {locator, targetDescription} = resolveTargetLocator(ctx, {
              uid,
              toolName: 'click_at',
            });
            const page = ctx.getSelectedPage?.();
            if (!page) {
              throw createToolError(
                ErrorCodes.PAGE_REQUIRED,
                '当前没有活动页面，无法执行 uid 坐标点击。',
                {toolName: 'click_at', uid},
              );
            }
            await locator.scrollIntoViewIfNeeded?.().catch(() => undefined);
            const box = await locator.boundingBox();
            if (!box) {
              await locator.click({clickCount: dblClick ? 2 : 1});
              response.setStructuredContent({
                success: true,
                message: `JS fallback click at ${targetDescription}`,
                tooltype: 'click_at',
                data: {
                  uid,
                  x: 0,
                  y: 0,
                  dblClick,
                  tag: '',
                  text: '',
                  source: 'jsClick',
                },
              });
              return;
            }
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            await dispatchCdpClick(page, cx, cy, dblClick);
            response.setStructuredContent({
              success: true,
              message: `Real mouse click at ${targetDescription} (${cx}, ${cy}) via boundingBox`,
              tooltype: 'click_at',
              data: {
                uid,
                x: cx,
                y: cy,
                dblClick,
                tag: '',
                text: '',
                source: 'boundingBox',
              },
            });
            return;
          }

          const frame = ctx.getSelectedFrame();
          const resolution = await resolveClickPoint(frame, selector!);

          if (resolution.kind === 'jsClick') {
            await frame.locator(selector!).click({
              clickCount: dblClick ? 2 : 1,
            });
            response.setStructuredContent({
              success: true,
              message: `JS fallback click at ${selector}`,
              tooltype: 'click_at',
              data: {x: 0, y: 0, tag: '', text: '', source: 'jsClick'},
            });
            return;
          }

          await dispatchCdpClick(
            frame.page(),
            resolution.x,
            resolution.y,
            dblClick,
          );

          response.setStructuredContent({
            success: true,
            message: `Real mouse click at ${selector} (${resolution.x}, ${resolution.y}) via ${resolution.source}`,
            tooltype: 'click_at',
            data: {
              x: resolution.x,
              y: resolution.y,
              dblClick,
              tag: '',
              text: '',
              source: resolution.source,
              quadCount: resolution.quadCount,
            },
          });
        },
        {includeSnapshot},
      );
    } catch (error) {
      throw toElementError(error, {toolName: 'click_at', selector, uid});
    }
  },
});

// ─── drag.ts ─────────────────────────────────────────────

/**
 * 将元素从源位置拖拽到目标位置。支持 uid 与 selector 双模定位。
 */
export const drag = definePageTool({
  name: 'drag',
  description:
    '通过鼠标事件将元素从源位置（fromUid/fromSelector）拖拽到目标位置（toUid/toSelector）。',
  annotations: {
    title: '拖拽元素',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    fromUid: zod
      .string()
      .optional()
      .describe('拖拽源元素在 take_snapshot 中的 uid。'),
    toUid: zod
      .string()
      .optional()
      .describe('拖拽目标元素在 take_snapshot 中的 uid。'),
    fromSelector: zod
      .string()
      .optional()
      .describe(
        '拖拽源定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
    toSelector: zod
      .string()
      .optional()
      .describe(
        '拖拽目标定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
    includeSnapshot: zod
      .boolean()
      .optional()
      .describe('拖拽完成后是否附带最新页面无障碍树快照（默认 false）。'),
  },
  handler: async (request, response, context) => {
    const {fromUid, toUid, fromSelector, toSelector, includeSnapshot} =
      request.params;
    const ctx = context as Context;

    if ((!fromUid && !fromSelector) || (!toUid && !toSelector)) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        '必须同时指定源元素（fromUid/fromSelector）和目标元素（toUid/toSelector）。',
        {toolName: 'drag'},
      );
    }

    const page = ctx.getSelectedPage?.() ?? ctx.getSelectedFrame().page();

    try {
      const result = await runInputAction(
        ctx,
        response,
        async () => {
          const fromTarget = resolveTargetLocator(ctx, {
            uid: fromUid,
            selector: fromSelector,
            toolName: 'drag',
          });
          const toTarget = resolveTargetLocator(ctx, {
            uid: toUid,
            selector: toSelector,
            toolName: 'drag',
          });

          const fromBox = await fromTarget.locator.boundingBox();
          if (!fromBox) {
            throw createToolError(
              ErrorCodes.NOT_FOUND,
              `Source element bounding box not available: ${fromTarget.targetDescription}`,
              {toolName: 'drag', fromSelector, fromUid},
            );
          }
          const toBox = await toTarget.locator.boundingBox();
          if (!toBox) {
            throw createToolError(
              ErrorCodes.NOT_FOUND,
              `Target element bounding box not available: ${toTarget.targetDescription}`,
              {toolName: 'drag', toSelector, toUid},
            );
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
            fromDesc: fromTarget.targetDescription,
            toDesc: toTarget.targetDescription,
            from: {x: fromX, y: fromY},
            to: {x: toX, y: toY},
          };
        },
        {includeSnapshot},
      );

      response.setStructuredContent({
        success: true,
        message: `Successfully dragged element from ${result.fromDesc} to ${result.toDesc}`,
        tooltype: 'drag',
        data: {
          fromSelector,
          toSelector,
          ...(fromUid !== undefined ? {fromUid} : {}),
          ...(toUid !== undefined ? {toUid} : {}),
          from: result.from,
          to: result.to,
        },
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'drag',
        selector: fromSelector,
        uid: fromUid,
        fromSelector,
        toSelector,
        fromUid,
        toUid,
      });
    }
  },
});

// ─── fill.ts ─────────────────────────────────────────────

/**
 * 在 input/textarea/select/checkbox/radio 元素中填入或切换值。支持 uid 与 selector 双模定位。
 */
export const fill = definePageTool({
  name: 'fill',
  description:
    '向输入或选择控件填入值，<select> 自动调用 selectOption，复选框/开关/单选支持布尔值切换。支持由 take_snapshot 产生的 uid（推荐）或传统定位器。',
  annotations: {
    title: '填充输入',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    uid: zod
      .string()
      .optional()
      .describe(
        '由 take_snapshot 返回的元素唯一编号，如 "1_4"。推荐优先使用，稳定且免疫动态 Class 混淆。',
      ),
    selector: zod
      .string()
      .optional()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。当未提供 uid 时必填。多匹配时用 >> nth=N 消歧。',
      ),
    value: zod.string().describe('填充值（复选框/开关支持 "true"/"false"）。'),
    includeSnapshot: zod
      .boolean()
      .optional()
      .describe('填充完成后是否附带最新页面无障碍树快照（默认 false）。'),
    timeoutMs: browserTimeoutSchema('单次页面操作超时（毫秒，默认 10000）。'),
  },
  handler: async (request, response, context) => {
    const {uid, selector, timeoutMs, value, includeSnapshot} = request.params;
    let resolvedDescription = selector || (uid ? `uid=${uid}` : '');

    try {
      const {found, isSelect, isToggle, targetDescription} =
        await runInputAction(
          context,
          response,
          () =>
            withDebuggerTrapBypass(context, async () => {
              const {locator, targetDescription} = resolveTargetLocator(
                context,
                {
                  uid,
                  selector,
                  toolName: 'fill',
                },
              );
              resolvedDescription = targetDescription;
              const result = await fillTargetLocator(locator, value, timeoutMs);
              return {...result, targetDescription};
            }),
          {includeSnapshot},
        );

      if (!found) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `Element not found: ${targetDescription}`,
          {toolName: 'fill', selector, uid, target: targetDescription},
        );
      }

      response.setStructuredContent({
        success: true,
        message: `Successfully filled value into element: ${targetDescription}`,
        tooltype: 'fill',
        data: {
          selector,
          ...(uid !== undefined ? {uid} : {}),
          value,
          isSelect,
          ...(isToggle ? {isToggle} : {}),
        },
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'fill',
        selector,
        uid,
        target: resolvedDescription,
        value,
      });
    }
  },
});

// ─── fillForm.ts ─────────────────────────────────────────

/**
 * 批量填充表单元素，支持 uid 与 selector 双模。
 */
export const fillForm = definePageTool({
  name: 'fill_form',
  description:
    '在一次调用中批量填充多个表单元素，每个条目支持通过 uid（推荐）或 selector 定位，自动处理 <select> 与复选框。',
  annotations: {
    title: '批量填充表单',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    elements: zod
      .array(
        zod.object({
          uid: zod
            .string()
            .optional()
            .describe('由 take_snapshot 返回的元素唯一编号，如 "1_4"。'),
          selector: zod
            .string()
            .optional()
            .describe(
              '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
            ),
          value: zod.string().describe('填充值。'),
        }),
      )
      .describe('要填充的元素列表。'),
    includeSnapshot: zod
      .boolean()
      .optional()
      .describe('填充完成后是否附带最新页面无障碍树快照（默认 false）。'),
    timeoutMs: browserTimeoutSchema(
      '每个元素的单次页面操作超时（毫秒，默认 10000）。',
    ),
  },
  handler: async (request, response, context) => {
    const {elements, timeoutMs, includeSnapshot} = request.params;
    const ctx = context as Context;

    if (!Array.isArray(elements) || elements.length === 0) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'fill_form requires a non-empty "elements" array',
        {toolName: 'fill_form'},
      );
    }

    const total = elements.length;
    let filled = 0;

    try {
      await runInputAction(
        ctx,
        response,
        () =>
          withDebuggerTrapBypass(ctx, async () => {
            for (const element of elements) {
              const {locator} = resolveTargetLocator(ctx, {
                uid: element.uid,
                selector: element.selector,
                toolName: 'fill_form',
              });
              const result = await fillTargetLocator(
                locator,
                element.value,
                timeoutMs,
              );
              if (result.found) filled += 1;
            }
          }),
        {includeSnapshot},
      );

      response.setStructuredContent({
        success: true,
        message: `Successfully filled out ${filled}/${total} form elements`,
        tooltype: 'fill_form',
        data: {filled, total, elements},
      });
    } catch (error) {
      const toolError = toElementError(error, {
        toolName: 'fill_form',
        filled,
        total,
      });
      throw toolError;
    }
  },
});

// ─── hover.ts ────────────────────────────────────────────

/**
 * 将鼠标悬停在指定元素上。支持 uid 与 selector 双模定位。
 */
export const hover = definePageTool({
  name: 'hover',
  description:
    '将鼠标悬停在指定元素上。支持由 take_snapshot 产生的 uid（推荐）或传统定位器（CSS、role=、text=、xpath=）。',
  annotations: {
    title: '悬停元素',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    uid: zod
      .string()
      .optional()
      .describe(
        '由 take_snapshot 返回的元素唯一编号，如 "1_4"。推荐优先使用，稳定且免疫动态 Class 混淆。',
      ),
    selector: zod
      .string()
      .optional()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。当未提供 uid 时必填。多匹配时用 >> nth=N 消歧。',
      ),
    includeSnapshot: zod
      .boolean()
      .optional()
      .describe('悬停完成后是否附带最新页面无障碍树快照（默认 false）。'),
  },
  handler: async (request, response, context) => {
    const {uid, selector, includeSnapshot} = request.params;
    let resolvedDescription = selector || (uid ? `uid=${uid}` : '');

    try {
      const targetDescription = await runInputAction(
        context,
        response,
        async () => {
          const {locator, targetDescription} = resolveTargetLocator(context, {
            uid,
            selector,
            toolName: 'hover',
          });
          resolvedDescription = targetDescription;
          await locator.hover();
          return targetDescription;
        },
        {includeSnapshot},
      );
      response.setStructuredContent({
        success: true,
        message: `Successfully hovered over element: ${targetDescription}`,
        tooltype: 'hover',
        data: {
          selector,
          ...(uid !== undefined ? {uid} : {}),
        },
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'hover',
        selector,
        uid,
        target: resolvedDescription,
      });
    }
  },
});

// ─── pressKey.ts ─────────────────────────────────────────

/**
 * 按下键盘按键或组合键。
 */
export const pressKey = definePageTool({
  name: 'press_key',
  description:
    '按下键盘按键或组合键（如 "Enter"、"Control+A"、"Alt+Shift+F"），支持修饰键。',
  annotations: {
    title: '按键',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    key: zod.string().describe('按键或组合键，如 "Enter", "Control+A"。'),
    includeSnapshot: zod
      .boolean()
      .optional()
      .describe('按键完成后是否附带最新页面无障碍树快照（默认 false）。'),
  },
  handler: async (request, response, context) => {
    const {key, includeSnapshot} = request.params;
    const ctx = context as Context;
    const frame = ctx.getSelectedFrame();
    const page = frame.page();

    try {
      const tokens = parseKey(key);
      const [mainKey, ...modifiers] = tokens;

      await runInputAction(
        ctx,
        response,
        async () => {
          const pressedModifiers: typeof modifiers = [];
          try {
            for (const modifier of modifiers) {
              await page.keyboard.down(modifier);
              pressedModifiers.push(modifier);
            }
            await page.keyboard.press(mainKey);
          } finally {
            for (const modifier of pressedModifiers.toReversed()) {
              await page.keyboard.up(modifier).catch(() => undefined);
            }
          }
        },
        {includeSnapshot},
      );

      response.setStructuredContent({
        success: true,
        message: `Successfully pressed key: ${key}`,
        tooltype: 'press_key',
        data: {key, mainKey, modifiers},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'press_key', key},
      );
    }
  },
});

// ─── uploadFile.ts ───────────────────────────────────────

const PROBE_ATTR = 'data-pcli-upload-probe';

/** 等待 filechooser 事件的超时时间（毫秒）。 */
const FILECHOOSER_TIMEOUT_MS = 3000;

/**
 * 上传文件到 file input 元素，依次尝试 Playwright 原生 setInputFiles、filechooser 事件模式及 CDP DOM.setFileInputFiles 三级降级。
 */
export const uploadFile = definePageTool({
  name: 'upload_file',
  description:
    '向 file input 元素上传单个或多个文件，支持 uid（推荐）与 selector 双模定位；依次尝试 Playwright 原生 setInputFiles、filechooser 事件模式及 CDP DOM.setFileInputFiles 三级降级。',
  annotations: {
    title: '上传文件',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    uid: zod
      .string()
      .optional()
      .describe('由 take_snapshot 返回的元素唯一编号，如 "1_4"。'),
    selector: zod
      .string()
      .optional()
      .describe(
        '定位器：支持完整定位器语法，包括 CSS（#id、.cls）、role=、text=、xpath= 及 >> nth=N 消歧。当未提供 uid 时必填。',
      ),
    filePath: zod
      .string()
      .optional()
      .describe(
        '单个文件绝对路径（向后兼容单文件上传，与 filePaths 二选一）。',
      ),
    filePaths: zod
      .array(zod.string())
      .optional()
      .describe('多个文件绝对路径数组，支持多文件上传。'),
    includeSnapshot: zod
      .boolean()
      .optional()
      .describe('上传完成后是否附带最新页面无障碍树快照（默认 false）。'),
  },
  handler: async (request, response, context) => {
    const {uid, selector, filePath, filePaths, includeSnapshot} =
      request.params;
    const ctx = context as Context;
    const frame = ctx.getSelectedFrame();
    if (!uid && !frame) {
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'upload_file',
      });
    }

    const resolvedFiles =
      filePaths && filePaths.length > 0
        ? filePaths
        : filePath
          ? [filePath]
          : [];
    if (resolvedFiles.length === 0) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'upload_file 需要提供 filePath 或非空的 filePaths 数组。',
        {toolName: 'upload_file'},
      );
    }

    const setFilesArg =
      resolvedFiles.length === 1 ? resolvedFiles[0] : resolvedFiles;
    const filesLabel = resolvedFiles.join(', ');
    const {locator: loc, targetDescription} = resolveTargetLocator(ctx, {
      uid,
      selector,
      toolName: 'upload_file',
    });
    const page = ctx.getSelectedPage?.() ?? frame.page();
    let nativeError: string | undefined;
    let fileChooserError: string | undefined;

    try {
      await runInputAction(
        ctx,
        response,
        async () => {
          // 1. Playwright native setInputFiles
          try {
            await loc.setInputFiles(setFilesArg);
            response.setStructuredContent({
              success: true,
              message: `File uploaded from ${filesLabel}`,
              tooltype: 'upload_file',
              data: {
                selector,
                ...(uid !== undefined ? {uid} : {}),
                filePath: resolvedFiles[0],
                ...(filePaths ? {filePaths: resolvedFiles} : {}),
                strategy: 'native',
              },
            });
            return;
          } catch (innerError) {
            const classification = classifyElementError(innerError);
            if (classification.code === ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS) {
              throw innerError;
            }
            nativeError =
              innerError instanceof Error
                ? innerError.message
                : String(innerError);
          }

          // 2. Fallback: filechooser event pattern
          try {
            const chooserPromise = page.waitForEvent('filechooser', {
              timeout: FILECHOOSER_TIMEOUT_MS,
            });
            chooserPromise.catch(() => undefined);
            const [fileChooser] = await Promise.all([
              chooserPromise,
              loc.click(),
            ]);
            await fileChooser.setFiles(setFilesArg);
            response.setStructuredContent({
              success: true,
              message: `File uploaded from ${filesLabel}`,
              tooltype: 'upload_file',
              data: {
                selector,
                ...(uid !== undefined ? {uid} : {}),
                filePath: resolvedFiles[0],
                ...(filePaths ? {filePaths: resolvedFiles} : {}),
                fallback: true,
                strategy: 'filechooser',
              },
            });
            return;
          } catch (innerError) {
            const classification = classifyElementError(innerError);
            if (classification.code === ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS) {
              throw innerError;
            }
            fileChooserError =
              innerError instanceof Error
                ? innerError.message
                : String(innerError);
          }

          // 3. Fallback: CDP DOM.setFileInputFiles via probe-attribute bridge
          const probe = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          const target = loc.first();
          try {
            await target.evaluate(
              (node: unknown, [attr, value]: unknown[]) => {
                (node as Element).setAttribute(attr as string, value as string);
              },
              [PROBE_ATTR, probe],
            );

            await withCdpSession(page, async client => {
              await client.send('DOM.enable');
              const doc = (await client.send('DOM.getDocument', {
                depth: 0,
              })) as {
                root?: {nodeId: number};
              };
              const rootNodeId = doc?.root?.nodeId;
              const {nodeId} = (await client.send('DOM.querySelector', {
                nodeId: rootNodeId,
                selector: `[${PROBE_ATTR}="${probe}"]`,
              })) as {nodeId: number};

              if (!nodeId) {
                throw createToolError(
                  ErrorCodes.NOT_FOUND,
                  `Element not found via CDP probe: ${targetDescription}`,
                  {toolName: 'upload_file', selector, uid},
                );
              }

              await client.send('DOM.setFileInputFiles', {
                nodeId,
                files: resolvedFiles,
              });
            });

            response.setStructuredContent({
              success: true,
              message: `File uploaded from ${filesLabel}`,
              tooltype: 'upload_file',
              data: {
                selector,
                ...(uid !== undefined ? {uid} : {}),
                filePath: resolvedFiles[0],
                ...(filePaths ? {filePaths: resolvedFiles} : {}),
                fallback: true,
                strategy: 'cdp',
              },
            });
          } finally {
            try {
              await target.evaluate((node: unknown, attr: unknown) => {
                (node as Element).removeAttribute(attr as string);
              }, PROBE_ATTR);
            } catch {
              // 忽略元素移除/已销毁时的清理错误
            }
          }
        },
        {includeSnapshot},
      );
    } catch (error) {
      const toolError = toElementError(error, {
        toolName: 'upload_file',
        selector,
        uid,
        filePath: resolvedFiles[0],
        ...(filePaths ? {filePaths: resolvedFiles} : {}),
      });
      if (nativeError !== undefined || fileChooserError !== undefined) {
        const cdpError = error instanceof Error ? error.message : String(error);
        throw createToolError(
          toolError.code,
          toolError.message,
          toolError.context,
          {
            retryable: toolError.retryable,
            recovery: toolError.recovery,
            details: {
              native: nativeError,
              filechooser: fileChooserError,
              cdp: cdpError,
            },
          },
        );
      }
      throw toolError;
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'input',
  description: 'User input simulation tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './input.js',
      handlerName: 'click',
      requirements: {
        browser: 'connected',
        page: 'selected',
        frame: 'selected',
        debugger: 'running',
      },
    },
    {modulePath: './input.js', handlerName: 'pressKey'},
    {modulePath: './input.js', handlerName: 'fillForm'},
    {modulePath: './input.js', handlerName: 'uploadFile'},
    {modulePath: './input.js', handlerName: 'hover'},
    {modulePath: './input.js', handlerName: 'drag'},
    {modulePath: './input.js', handlerName: 'clickAt'},
    {modulePath: './input.js', handlerName: 'fill'},
  ],
} satisfies DomainManifest;
