/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';

import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const defaultFunctionFixture = async (
  params: Record<string, unknown>,
) => ({
  received: params,
  tooltype: 'default_function_fixture',
});

export const contextFunctionFixture = async (
  context: unknown,
  params: Record<string, unknown>,
) => ({
  sameProvider: Boolean(
    context &&
      typeof context === 'object' &&
      'getSelectedPage' in context,
  ),
  received: params,
  tooltype: 'context_function_fixture',
});

export const frameFunctionFixture = async (
  frame: {evaluate: (script: string) => Promise<unknown>},
  params: Record<string, unknown>,
) => ({
  evaluated: await frame.evaluate('window.__fixtureValue'),
  received: params,
  tooltype: 'frame_function_fixture',
});

export const defineToolFixture = defineTool({
  name: 'define_tool_fixture',
  description: 'Test-only defineTool fixture',
  annotations: {
    category: ToolCategory.DATA,
    readOnlyHint: true,
  },
  schema: {
    value: zod.string().describe('Fixture value'),
  },
  handler: async (request, response, context) => {
    response.setStructuredContent({
      selectedPageAvailable: Boolean(context.getSelectedPage()),
      received: request.params,
      tooltype: 'define_tool_fixture',
    });
  },
});

export const throwingFixture = async () => {
  throw new Error('fixture failure');
};
