/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';
import {defineTool} from './ToolDefinition.js';
import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';

/**
 * 点击元素
 */
export const click = defineTool({
  name: 'click',
  description: 'Clicks on the provided element identified by CSS selector',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector of the element to click'),
    dblClick: zod
      .boolean()
      .optional()
      .describe('Set to true for double clicks. Default is false.'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();

    await page.click(request.params.selector, {
      clickCount: request.params.dblClick ? 2 : 1,
    });

    response.appendResponseLine(
      request.params.dblClick
        ? `Successfully double clicked on element: ${request.params.selector}`
        : `Successfully clicked on element: ${request.params.selector}`,
    );
  },
});

/**
 * 🆕 真实鼠标点击 — CDP Input.dispatchMouseEvent
 * 算作用户真实手势，能触发文件对话框、绕过部分反自动化检测
 */
export const clickAt = defineTool({
  name: 'click_at',
  description: 'Real mouse click using CDP Input.dispatchMouseEvent. Acts as user gesture, can trigger file dialogs and bypass some anti-automation detection.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS selector of the element to click'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.pageController.clickAt(request.params.selector);

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      clicked: true,
      x: result.x,
      y: result.y,
      tag: result.tag,
      text: result.text
    }, null, 2));
    response.appendResponseLine('```');
  },
});

/**
 * 🆕 文件上传绕过对话框 — CDP DOM.setFileInputFiles
 * 直接设置 file input 的本地文件路径，完全绕过文件对话框
 */
export const setFiles = defineTool({
  name: 'set_files',
  description: 'Set files to a file input element using CDP DOM.setFileInputFiles. Bypasses file chooser dialog completely.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS selector of the file input element'),
    filePaths: zod.array(zod.string()).describe('Array of absolute file paths to upload'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.pageController.setFiles(
      request.params.selector,
      request.params.filePaths
    );

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

/**
 * 悬停在元素上
 */
export const hover = defineTool({
  name: 'hover',
  description: 'Hover over the provided element identified by CSS selector',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector of the element to hover over'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();

    const element = await page.$(request.params.selector);
    if (!element) {
      throw new Error(`Element not found: ${request.params.selector}`);
    }

    await element.hover();
    response.appendResponseLine(`Successfully hovered over element: ${request.params.selector}`);
  },
});

/**
 * 填充表单字段
 */
export const fill = defineTool({
  name: 'fill',
  description: 'Type text into an input, text area or select an option from a <select> element',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector of the input/textarea/select element'),
    value: zod.string().describe('The value to fill in'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();

    const element = await page.$(request.params.selector);
    if (!element) {
      throw new Error(`Element not found: ${request.params.selector}`);
    }

    // 检查是否是 select 元素
    const isSelect = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el?.tagName === 'SELECT';
    }, request.params.selector);

    if (isSelect) {
      await element.select(request.params.value);
    } else {
      await element.type(request.params.value);
    }

    response.appendResponseLine(`Successfully filled value into element: ${request.params.selector}`);
  },
});

/**
 * 拖拽元素
 */
export const drag = defineTool({
  name: 'drag',
  description: 'Drag an element onto another element',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    fromSelector: zod.string().describe('CSS selector of the element to drag'),
    toSelector: zod.string().describe('CSS selector of the element to drop into'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();

    const fromElement = await page.$(request.params.fromSelector);
    const toElement = await page.$(request.params.toSelector);

    if (!fromElement) {
      throw new Error(`Source element not found: ${request.params.fromSelector}`);
    }
    if (!toElement) {
      throw new Error(`Target element not found: ${request.params.toSelector}`);
    }

    // 获取源元素中心点
    const fromBox = await fromElement.boundingBox();
    const toBox = await toElement.boundingBox();

    if (!fromBox || !toBox) {
      throw new Error('Element bounding box not available');
    }

    const fromX = fromBox.x + fromBox.width / 2;
    const fromY = fromBox.y + fromBox.height / 2;
    const toX = toBox.x + toBox.width / 2;
    const toY = toBox.y + toBox.height / 2;

    // 移动鼠标到源元素
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();

    // 移动到目标元素
    await page.mouse.move(toX, toY);
    await page.mouse.up();

    response.appendResponseLine(`Successfully dragged element from ${request.params.fromSelector} to ${request.params.toSelector}`);
  },
});

/**
 * 批量填充表单
 */
export const fillForm = defineTool({
  name: 'fill_form',
  description: 'Fill out multiple form elements at once',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    elements: zod
      .array(
        zod.object({
          selector: zod.string().describe('CSS selector of the element to fill out'),
          value: zod.string().describe('Value for the element'),
        }),
      )
      .describe('Elements to fill out with their selectors and values'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();

    for (const element of request.params.elements) {
      const el = await page.$(element.selector);
      if (el) {
        // 检查是否是 select 元素
        const isSelect = await page.evaluate((sel) => {
          const ele = document.querySelector(sel);
          return ele?.tagName === 'SELECT';
        }, element.selector);

        if (isSelect) {
          await el.select(element.value);
        } else {
          await el.type(element.value);
        }
      }
    }

    response.appendResponseLine(`Successfully filled out ${request.params.elements.length} form elements`);
  },
});

/**
 * 上传文件
 */
export const uploadFile = defineTool({
  name: 'upload_file',
  description: 'Upload a file through a file input element',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector of the file input element'),
    filePath: zod.string().describe('The absolute path of the file to upload'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();

    const element = await page.$(request.params.selector);
    if (!element) {
      throw new Error(`Element not found: ${request.params.selector}`);
    }

    try {
      // 尝试直接使用 uploadFile 方法（需要类型断言）
      await (element as any).uploadFile(request.params.filePath);
      response.appendResponseLine(`File uploaded from ${request.params.filePath}`);
    } catch {
      // 如果不是 file input，尝试点击触发 file chooser
      try {
        const [fileChooser] = await Promise.all([
          page.waitForFileChooser({timeout: 3000}),
          element.click(),
        ]);
        await fileChooser.accept([request.params.filePath]);
        response.appendResponseLine(`File uploaded from ${request.params.filePath}`);
      } catch {
        throw new Error(
          `Failed to upload file. The element could not accept the file directly, and clicking it did not trigger a file chooser.`,
        );
      }
    }
  },
});

/**
 * 按下键盘按键
 */
export const pressKey = defineTool({
  name: 'press_key',
  description: 'Press a key or key combination. Use this when other input methods like fill() cannot be used (e.g., keyboard shortcuts, navigation keys, or special key combinations).',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    key: zod
      .string()
      .describe(
        'A key or a combination (e.g., "Enter", "Control+A", "Control++", "Control+Shift+R"). Modifiers: Control, Shift, Alt, Meta',
      ),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();
    const {parseKey} = await import('../utils/keyboard.js');

    const tokens = parseKey(request.params.key);
    const [key, ...modifiers] = tokens;

    for (const modifier of modifiers) {
      await page.keyboard.down(modifier);
    }
    await page.keyboard.press(key);
    for (const modifier of modifiers.toReversed()) {
      await page.keyboard.up(modifier);
    }

    response.appendResponseLine(
      `Successfully pressed key: ${request.params.key}`,
    );
  },
});
