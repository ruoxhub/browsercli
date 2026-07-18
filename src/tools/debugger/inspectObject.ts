/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';

/**
 * 深度检查一个 JavaScript 对象，展示其属性、原型链和方法。
 */
export const inspectObject = defineTool({
  name: 'inspect_object',
  description:
    '深度检查一个 JavaScript 对象，展示其属性、原型链与方法，便于理解对象结构。',
  annotations: {
    title: '检查对象',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    expression: zod
      .string()
      .describe(
        'JavaScript 表达式（如 "window.app", "document.body", "myObject"）.',
      ),
    depth: zod
      .number()
      .int()
      .optional()
      .default(2)
      .describe('嵌套检查深度（默认: 2）。'),
    showMethods: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否展示方法（默认: true）。'),
    showPrototype: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否展示原型链（默认: true）。'),
  },
  handler: async (request, response, context) => {
    const {expression, depth, showMethods, showPrototype} = request.params;

    try {
      const frame = (context as Context).getSelectedFrame();
      const result = await evaluateInPageRuntime<Record<string, unknown>>(
        frame,
        `
(function() {
  const maxDepth = ${depth};
  const showMethods = ${showMethods};
  const showPrototype = ${showPrototype};

  let target;
  try {
    target = (0, eval)(${JSON.stringify(expression)});
  } catch(e) {
    return { error: 'Cannot evaluate: ' + e.message };
  }

  if (target === null) return { type: 'null', value: null };
  if (target === undefined) return { type: 'undefined', value: undefined };

  const seen = new WeakSet();

  function inspect(obj, currentDepth) {
    if (currentDepth > maxDepth) return '[Max depth reached]';
    if (obj === null) return null;
    if (obj === undefined) return undefined;

    const type = typeof obj;
    if (type !== 'object' && type !== 'function') return obj;

    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    if (Array.isArray(obj)) {
      if (obj.length > 100) return '[Array(' + obj.length + ')]';
      return obj.slice(0, 20).map(item => inspect(item, currentDepth + 1));
    }

    const result = {};
    const props = Object.getOwnPropertyNames(obj);

    for (const prop of props.slice(0, 50)) {
      try {
        const value = obj[prop];
        const valueType = typeof value;

        if (valueType === 'function') {
          if (showMethods) {
            result[prop] = '[Function: ' + (value.name || 'anonymous') + ']';
          }
        } else if (valueType === 'object' && value !== null) {
          result[prop] = inspect(value, currentDepth + 1);
        } else {
          result[prop] = value;
        }
      } catch(e) {
        result[prop] = '[Error: ' + e.message + ']';
      }
    }

    if (props.length > 50) {
      result['...'] = (props.length - 50) + ' more properties';
    }

    return result;
  }

  const result = {
    type: typeof target,
    constructor: target.constructor?.name,
    value: inspect(target, 0),
  };

  if (showPrototype && (typeof target === 'object' || typeof target === 'function') && target !== null) {
    const protoChain = [];
    let proto = Object.getPrototypeOf(target);
    while (proto && protoChain.length < 5) {
      protoChain.push(proto.constructor?.name || 'Object');
      proto = Object.getPrototypeOf(proto);
    }
    result.prototypeChain = protoChain;
  }

  return result;
})()
`,
      );

      if (result && typeof result === 'object' && 'error' in result) {
        response.setStructuredContent({
          success: false,
          message: (result as {error: string}).error,
          tooltype: 'inspect_object',
          data: {expression},
        });
        return;
      }

      response.setStructuredContent({
        success: true,
        message: `对象检查：${expression}`,
        tooltype: 'inspect_object',
        data: {
          expression,
          result: result,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'inspect_object',
        data: {expression: request.params.expression},
      });
    }
  },
});
