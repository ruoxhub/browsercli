/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * 反 Hook 检测：保护 Function.prototype.toString，使被 Hook 的方法看起来像原生代码。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param hookedMethods - 已被 Hook 的方法路径列表，如 ["console.table", "localStorage.setItem"]
 * @returns 结构化结果对象
 */
export async function antiAntiHook(
  frame: Frame,
  hookedMethods?: string[],
): Promise<HookResult> {
  const methods = hookedMethods || [];

  const hookCode = `
(function() {
  'use strict';
  const hookedMethods = ${JSON.stringify(methods)};
  const hookedFunctions = new Map();
${buildHookStoreRuntime({
  hookId: 'anti_anti_hook',
  type: 'function',
  target: 'Function.prototype.toString',
})}

  // Resolve hooked methods from global object
  for (let methodPath of hookedMethods) {
    let ref = window;
    let parts = methodPath.split('.');
    try {
      for (let i = 0; i < parts.length - 1; i++) {
        ref = ref[parts[i]];
        if (!ref) break;
      }
      if (ref) {
        const fn = ref[parts[parts.length - 1]];
        if (typeof fn === 'function') {
          hookedFunctions.set(fn, parts[parts.length - 1]);
        }
      }
    } catch (e) {}
  }

  // Proxy Function.prototype.toString to return native-looking code
  const temp_toString = Function.prototype.toString;
  Function.prototype.toString = function() {
    if (this === Function.prototype.toString) {
      return 'function toString() { [native code] }';
    } else if (hookedFunctions.has(this)) {
      const funcName = hookedFunctions.get(this);
      __pushHookRecord({
        event: 'toString_masked',
        functionName: funcName,
      });
      return 'function ' + funcName + '() { [native code] }';
    }
    return temp_toString.apply(this, arguments);
  };

  // Protect Object.getOwnPropertyDescriptor against hook detection
  const tempGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const hookedPropertyNames = new Set(hookedMethods.map(function(p) {
    return p.split('.').pop();
  }));

  Object.getOwnPropertyDescriptor = function(obj, prop) {
    var result = tempGetOwnPropertyDescriptor.call(this, obj, prop);
    if (result && typeof result.value === 'function' && hookedFunctions.has(result.value)) {
      __pushHookRecord({
        event: 'descriptor_masked',
        property: String(prop),
      });
      result.value = function() { return 'native'; };
    }
    return result;
  };

  // Shared iframe protection function
  function protectWindow(targetWindow) {
    try {
      if (targetWindow.Function && targetWindow.Function.prototype) {
        targetWindow.Function.prototype.toString = Function.prototype.toString;
      }
      // Patch Object.getOwnPropertyDescriptor in target window
      if (targetWindow.Object && targetWindow.Object.getOwnPropertyDescriptor) {
        var origGopd = targetWindow.Object.getOwnPropertyDescriptor;
        targetWindow.Object.getOwnPropertyDescriptor = function(obj, prop) {
          var result = origGopd.call(this, obj, prop);
          if (result && typeof result.value === 'function') {
            for (let entry of hookedFunctions.entries()) {
              if (result.value === entry[0]) {
                result.value = function() { return 'native'; };
                break;
              }
            }
          }
          return result;
        };
      }
    } catch (e) { /* cross-origin iframe, skip */ }
  }

  // Proxy contentWindow — recursively protect nested iframes
  const propertyAccessor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  const getAccessor = propertyAccessor.get;

  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get: function() {
      const iframeWindow = getAccessor.apply(this);
      protectWindow(iframeWindow);
      return new Proxy(iframeWindow, {
        get(target, property) {
          if (property === 'Function') {
            const fn = Reflect.get(target, property, target);
            if (fn && fn.prototype) {
              fn.prototype.toString = Function.prototype.toString;
            }
            return fn;
          }
          const value = Reflect.get(target, property, target);
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
        }
      });
    }
  });

  // Proxy contentDocument — prevent detection via iframe DOM
  const contentDocumentAccessor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument');
  const getContentDoc = contentDocumentAccessor.get;

  Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
    get: function() {
      const doc = getContentDoc.apply(this);
      if (doc && doc.defaultView) {
        protectWindow(doc.defaultView);
      }
      return doc;
    }
  });

  // Intercept new iframe creation via MutationObserver
  const MutationObserver = window.MutationObserver;
  if (MutationObserver) {
    const observer = new MutationObserver(function(mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          if (added[j].nodeName === 'IFRAME') {
            try {
              const iframe = added[j];
              iframe.addEventListener('load', function() {
                if (iframe.contentWindow) {
                  protectWindow(iframe.contentWindow);
                }
              });
            } catch (e) { /* cross-origin, skip */ }
          }
        }
      }
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
  }
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message:
        methods.length > 0
          ? `Anti-Anti-Hook 已安装，保护方法数：${methods.length}`
          : 'Anti-Anti-Hook 已安装，基础 Function.prototype.toString 保护已启用',
      tooltype: 'anti_anti_hook',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'anti_anti_hook',
    };
  }
}
