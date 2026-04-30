/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';
import type {InspectObjectParams, InspectObjectResult} from './types.js';

/**
 * 深度检查一个 JavaScript 对象，展示其属性、原型链和方法。
 *
 * @param frame - Puppeteer Frame 对象，用于注入检查代码
 * @param params - 检查参数
 * @returns 结构化结果对象，data 包含检查结果
 */
export async function inspectObject(
  frame: Frame,
  params: InspectObjectParams,
): Promise<InspectObjectResult> {
  const {expression, depth = 2, showMethods = true, showPrototype = true} =
    params;

  try {
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
      return {
        success: false,
        message: (result as {error: string}).error,
        tooltype: 'inspect_object',
      };
    }

    return {
      success: true,
      message: `对象检查完成：${expression}`,
      tooltype: 'inspect_object',
      logFormat: 'json',
      data: result as Record<string, unknown>,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'inspect_object',
    };
  }
}
