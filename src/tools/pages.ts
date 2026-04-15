/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool, timeoutSchema} from './ToolDefinition.js';

// Default navigation timeout in milliseconds (10 seconds)
const DEFAULT_NAV_TIMEOUT = 10000;

async function tryNavigate(
  action: () => Promise<void>,
  successMsg: string,
  response: any,
): Promise<void> {
  try {
    await action();
    response.appendResponseLine(successMsg);
  } catch (error) {
    response.appendResponseLine(
      `Unable to ${successMsg.toLowerCase().split(' ')[1]}: ${error.message}.`,
    );
  }
}

export const listPages = defineTool({
  name: 'list_pages',
  description: `Get a list of pages open in the browser.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
    title: 'List pages',
  },
  schema: {},
  handler: async (_request, response, _context, _runtime) => {
    response.setIncludePages(true);
  },
});

export const selectPage = defineTool({
  name: 'select_page',
  description: `Select a page as a context for future tool calls.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
    title: 'Select page',
  },
  schema: {
    pageIdx: zod
      .number()
      .describe(
        'The index of the page to select. Call list_pages to list pages.',
      ),
  },
  handler: async (request, response, context, runtime) => {
    const page = context.getPageByIdx(request.params.pageIdx);
    await page.bringToFront();
    context.selectPage(page);
    runtime.syncPageContext(page);
    response.setIncludePages(true);
  },
});

export const newPage = defineTool({
  name: 'new_page',
  description: `Creates a new page and navigates to the specified URL. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
    title: 'Create new page',
  },
  schema: {
    url: zod.string().describe('URL to load in a new page.'),
    ...timeoutSchema,
  },
  handler: async (request, response, context, _runtime) => {
    const page = await context.newPage();

    await context.waitForEventsAfterAction(async () => {
      await page.goto(request.params.url, {
        timeout: request.params.timeout ?? DEFAULT_NAV_TIMEOUT,
        waitUntil: 'domcontentloaded',
      });
    });

    response.setIncludePages(true);
  },
});

export const navigatePage = defineTool({
  name: 'navigate_page',
  description: `Navigates the currently selected page to a URL, or performs back/forward/reload navigation. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
    title: 'Navigate page',
  },
  schema: {
    type: zod
      .enum(['url', 'back', 'forward', 'reload'])
      .optional()
      .describe(
        'Navigate the page by URL, back or forward in history, or reload.',
      ),
    url: zod.string().optional().describe('Target URL (only type=url)'),
    ignoreCache: zod
      .boolean()
      .optional()
      .describe('Whether to ignore cache on reload.'),
    ...timeoutSchema,
  },
  handler: async (request, response, context, _runtime) => {
    const page = context.getSelectedPage();
    const options = {
      timeout: request.params.timeout ?? DEFAULT_NAV_TIMEOUT,
    };
    const navType = request.params.type || 'url';

    if (navType === 'url' && !request.params.url) {
      throw new Error('A URL is required for navigation of type=url.');
    }

    await context.waitForEventsAfterAction(async () => {
      switch (navType) {
        case 'url':
          await tryNavigate(
            () =>
              page.goto(request.params.url!, {
                ...options,
                waitUntil: 'domcontentloaded',
              }),
            `Successfully navigated to ${request.params.url}.`,
            response,
          );
          break;
        case 'back':
          await tryNavigate(
            () =>
              page.goBack({
                ...options,
                waitUntil: 'domcontentloaded',
              }),
            `Successfully navigated back to ${page.url()}.`,
            response,
          );
          break;
        case 'forward':
          await tryNavigate(
            () =>
              page.goForward({
                ...options,
                waitUntil: 'domcontentloaded',
              }),
            `Successfully navigated forward to ${page.url()}.`,
            response,
          );
          break;
        case 'reload':
          await tryNavigate(
            () =>
              page.reload({
                ...options,
                waitUntil: 'domcontentloaded',
                ignoreCache: request.params.ignoreCache,
              }),
            'Successfully reloaded the page.',
            response,
          );
          break;
      }
    });

    response.setIncludePages(true);
  },
});
