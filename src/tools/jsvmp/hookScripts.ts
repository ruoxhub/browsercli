/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-empty -- Page probes are fail-open by design. */

export interface JsvmpProxyHookOptions {
  scriptUrl: string;
  maxEntries: number;
  trackCalls: boolean;
  trackProps: boolean;
  trackReflect: boolean;
  proxyObjects: string[];
}

export interface JsvmpTransparentHookOptions {
  scriptUrl: string;
  maxEntries: number;
}

interface JsvmpProbeWindow extends Window {
  __mcp_jsvmp_installed?: boolean;
  __mcp_jsvmp_transparent_installed?: boolean;
  __mcp_jsvmp_log?: Array<Record<string, unknown>>;
  __mcp_proxy_originals?: Record<string, unknown>;
  __mcp_transparent_originals?: Array<{
    owner: object;
    prop: string;
    descriptor: PropertyDescriptor;
  }>;
  __mcp_jsvmp_uninstall?: () => {restored: string[]};
  __mcp_transparent_uninstall?: () => {restored: string[]};
}

function installJsvmpProxyHook(config: JsvmpProxyHookOptions): void {
  const probeWindow = window as JsvmpProbeWindow;
  if (probeWindow.__mcp_jsvmp_installed) {
    try {
      console.log('[JSVMP] Already installed, skipping');
    } catch {}
    return;
  }

  probeWindow.__mcp_jsvmp_installed = true;
  probeWindow.__mcp_jsvmp_log = probeWindow.__mcp_jsvmp_log ?? [];
  probeWindow.__mcp_proxy_originals = probeWindow.__mcp_proxy_originals ?? {};

  const OriginalError = Error;
  const originalArrayFrom = Array.from;
  const originalJsonStringify = JSON.stringify;
  const originalDateNow = Date.now;
  const originalDefineProperty = Object.defineProperty;
  const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const originalHasOwnProperty = Object.prototype.hasOwnProperty;
  const originalFunctionApply = Function.prototype.apply;
  const originalFunctionBind = Function.prototype.bind;
  const originalFunctionToString = Function.prototype.toString;
  const originalReflectApply = Reflect.apply;
  const originalReflectConstruct = Reflect.construct;
  const originalReflectGet = Reflect.get;
  const originalReflectSet = Reflect.set;
  const restoreActions: Array<() => string | null> = [];
  let active = false;
  let recording = false;

  function preview(value: unknown, maxLength = 200): string {
    try {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      if (typeof value === 'function') {
        let source = '';
        try {
          source = originalReflectApply(originalFunctionToString, value, []);
        } catch {}
        return `[Function ${value.name || 'anonymous'}${
          source.length < 80 ? `: ${source}` : ''
        }]`;
      }
      if (typeof value === 'object') {
        const serialized = originalJsonStringify(value);
        if (typeof serialized === 'string') {
          return serialized.length > maxLength
            ? `${serialized.substring(0, maxLength)}...`
            : serialized;
        }
      }
      const text = String(value);
      return text.length > maxLength
        ? `${text.substring(0, maxLength)}...`
        : text;
    } catch {
      try {
        return String(value).substring(0, maxLength);
      } catch {
        return '[unprintable]';
      }
    }
  }

  function shortStack(): string {
    try {
      const stack = new OriginalError().stack ?? '';
      return stack.split('\n').slice(2, 8).join('\n');
    } catch {
      return '';
    }
  }

  function inTargetScript(stack: string): boolean {
    return !config.scriptUrl || stack.includes(config.scriptUrl);
  }

  function log(entry: Record<string, unknown>): void {
    const entries = probeWindow.__mcp_jsvmp_log!;
    if (entries.length >= config.maxEntries) return;
    entry.ts = originalReflectApply(originalDateNow, Date, []);
    entries.push(entry);
  }

  function record(createEntry: () => Record<string, unknown> | null): void {
    if (!active || recording) return;
    recording = true;
    try {
      const entry = createEntry();
      if (entry) log(entry);
    } catch {
      // Observation must never alter target behavior.
    } finally {
      recording = false;
    }
  }

  function typeName(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    try {
      const constructor = (value as {constructor?: {name?: string}})
        .constructor;
      return constructor?.name || typeof value;
    } catch {
      return typeof value;
    }
  }

  function replaceValue(
    owner: Record<PropertyKey, unknown>,
    key: PropertyKey,
    replacement: unknown,
    label: string,
  ): boolean {
    const hadOwn = originalReflectApply(originalHasOwnProperty, owner, [key]);
    const descriptor = originalGetOwnPropertyDescriptor(owner, key);
    try {
      originalDefineProperty(owner, key, {
        value: replacement,
        writable: true,
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
      });
    } catch {
      try {
        owner[key] = replacement;
        if (owner[key] !== replacement) return false;
      } catch {
        return false;
      }
    }

    restoreActions.push(() => {
      try {
        if (hadOwn && descriptor) {
          originalDefineProperty(owner, key, descriptor);
        } else {
          delete owner[key];
        }
        return label;
      } catch {
        return null;
      }
    });
    return true;
  }

  function maskAsNative(fn: CallableFunction, name: string): void {
    try {
      originalDefineProperty(fn, 'toString', {
        value: () => `function ${name}() { [native code] }`,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    } catch {}
  }

  if (config.trackCalls) {
    const applyHook = function (
      this: CallableFunction,
      thisArg: unknown,
      argsArray?: ArrayLike<unknown> | null,
    ): unknown {
      record(() => {
        const stack = shortStack();
        if (!inTargetScript(stack)) return null;
        return {
          type: 'fn_apply',
          name: this.name || 'anonymous',
          args: preview(argsArray ? originalArrayFrom(argsArray) : [], 300),
          thisType: typeName(thisArg),
          stack,
        };
      });
      return originalReflectApply(originalFunctionApply, this, [
        thisArg,
        argsArray,
      ]);
    };
    maskAsNative(applyHook, 'apply');
    replaceValue(
      Function.prototype as unknown as Record<PropertyKey, unknown>,
      'apply',
      applyHook,
      'Function.prototype.apply',
    );

    const callHook = function (
      this: CallableFunction,
      thisArg: unknown,
      ...args: unknown[]
    ): unknown {
      record(() => {
        const stack = shortStack();
        if (!inTargetScript(stack)) return null;
        return {
          type: 'fn_call',
          name: this.name || 'anonymous',
          args: preview(args, 300),
          thisType: typeName(thisArg),
          stack,
        };
      });
      return originalReflectApply(this, thisArg, args);
    };
    maskAsNative(callHook, 'call');
    replaceValue(
      Function.prototype as unknown as Record<PropertyKey, unknown>,
      'call',
      callHook,
      'Function.prototype.call',
    );

    const bindHook = function (
      this: CallableFunction,
      thisArg: unknown,
      ...args: unknown[]
    ): unknown {
      record(() => {
        const stack = shortStack();
        if (!inTargetScript(stack)) return null;
        return {
          type: 'fn_bind',
          name: this.name || 'anonymous',
          boundThisType: typeName(thisArg),
          stack,
        };
      });
      return originalReflectApply(originalFunctionBind, this, [
        thisArg,
        ...args,
      ]);
    };
    maskAsNative(bindHook, 'bind');
    replaceValue(
      Function.prototype as unknown as Record<PropertyKey, unknown>,
      'bind',
      bindHook,
      'Function.prototype.bind',
    );
  }

  if (config.trackReflect) {
    const reflectApplyHook = function (
      target: CallableFunction,
      thisArg: unknown,
      args: ArrayLike<unknown>,
    ): unknown {
      record(() => {
        const stack = shortStack();
        if (!inTargetScript(stack)) return null;
        return {
          type: 'reflect_apply',
          name: target?.name || 'anonymous',
          args: preview(args, 300),
          stack,
        };
      });
      return originalReflectApply(target, thisArg, args);
    };
    replaceValue(
      Reflect as unknown as Record<PropertyKey, unknown>,
      'apply',
      reflectApplyHook,
      'Reflect.apply',
    );

    const reflectGetHook = function (
      target: object,
      key: PropertyKey,
      receiver?: unknown,
    ): unknown {
      const value =
        arguments.length >= 3
          ? originalReflectGet(target, key, receiver)
          : originalReflectGet(target, key);
      record(() => {
        const stack = shortStack();
        if (!inTargetScript(stack)) return null;
        return {
          type: 'reflect_get',
          targetType: typeName(target),
          key: String(key),
          value: preview(value, 150),
          stack,
        };
      });
      return value;
    };
    replaceValue(
      Reflect as unknown as Record<PropertyKey, unknown>,
      'get',
      reflectGetHook,
      'Reflect.get',
    );

    const reflectSetHook = function (
      target: object,
      key: PropertyKey,
      value: unknown,
      receiver?: unknown,
    ): boolean {
      record(() => {
        const stack = shortStack();
        if (!inTargetScript(stack)) return null;
        return {
          type: 'reflect_set',
          targetType: typeName(target),
          key: String(key),
          value: preview(value, 150),
          stack,
        };
      });
      return arguments.length >= 4
        ? originalReflectSet(target, key, value, receiver)
        : originalReflectSet(target, key, value);
    };
    replaceValue(
      Reflect as unknown as Record<PropertyKey, unknown>,
      'set',
      reflectSetHook,
      'Reflect.set',
    );

    const reflectConstructHook = function (
      target: CallableFunction,
      args: ArrayLike<unknown>,
      newTarget?: CallableFunction,
    ): object {
      record(() => {
        const stack = shortStack();
        if (!inTargetScript(stack)) return null;
        return {
          type: 'reflect_construct',
          name: target?.name || 'anonymous',
          args: preview(args, 300),
          stack,
        };
      });
      return arguments.length >= 3
        ? originalReflectConstruct(target, args, newTarget)
        : originalReflectConstruct(target, args);
    };
    replaceValue(
      Reflect as unknown as Record<PropertyKey, unknown>,
      'construct',
      reflectConstructHook,
      'Reflect.construct',
    );
  }

  if (config.trackProps) {
    for (const propertyName of config.proxyObjects) {
      let original: unknown;
      try {
        original = (probeWindow as unknown as Record<string, unknown>)[
          propertyName
        ];
      } catch {
        continue;
      }
      if (
        original === null ||
        (typeof original !== 'object' && typeof original !== 'function')
      ) {
        continue;
      }

      probeWindow.__mcp_proxy_originals[propertyName] = original;
      let reading = false;
      let writing = false;
      const proxy = new Proxy(original as object, {
        get(target, key) {
          if (reading) return originalReflectGet(target, key, target);
          reading = true;
          try {
            const value = originalReflectGet(target, key, target);
            if (typeof key === 'string' && !key.startsWith('__mcp_')) {
              record(() => {
                const stack = shortStack();
                if (!inTargetScript(stack)) return null;
                return {
                  type: 'proxy_get',
                  obj: propertyName,
                  key,
                  value: preview(value, 150),
                  stack,
                };
              });
            }
            return typeof value === 'function'
              ? originalReflectApply(originalFunctionBind, value, [target])
              : value;
          } finally {
            reading = false;
          }
        },
        set(target, key, value) {
          if (writing) return originalReflectSet(target, key, value, target);
          writing = true;
          try {
            if (typeof key === 'string' && !key.startsWith('__mcp_')) {
              record(() => {
                const stack = shortStack();
                if (!inTargetScript(stack)) return null;
                return {
                  type: 'proxy_set',
                  obj: propertyName,
                  key,
                  value: preview(value, 150),
                  stack,
                };
              });
            }
            return originalReflectSet(target, key, value, target);
          } finally {
            writing = false;
          }
        },
        has(target, key) {
          record(() => {
            const stack = shortStack();
            if (!inTargetScript(stack)) return null;
            return {
              type: 'proxy_has',
              obj: propertyName,
              key: String(key),
              stack,
            };
          });
          return key in target;
        },
      });
      replaceValue(
        probeWindow as unknown as Record<PropertyKey, unknown>,
        propertyName,
        proxy,
        `window.${propertyName}`,
      );
    }
  }

  if (config.trackCalls) {
    const sensitiveApis: Array<{
      owner: Record<PropertyKey, unknown>;
      name: string;
      label: string;
    }> = [
      {
        owner: Date as unknown as Record<PropertyKey, unknown>,
        name: 'now',
        label: 'Date.now',
      },
      {
        owner: performance as unknown as Record<PropertyKey, unknown>,
        name: 'now',
        label: 'performance.now',
      },
      {
        owner: Math as unknown as Record<PropertyKey, unknown>,
        name: 'random',
        label: 'Math.random',
      },
    ];

    for (const api of sensitiveApis) {
      const original = api.owner[api.name];
      if (typeof original !== 'function') continue;
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        const result = originalReflectApply(original, this, args);
        record(() => {
          const stack = shortStack();
          if (!inTargetScript(stack)) return null;
          return {
            type: 'api_call',
            name: api.label,
            args: preview(args, 100),
            returnValue: preview(result, 100),
            stack,
          };
        });
        return result;
      };
      maskAsNative(wrapper, api.name);
      replaceValue(api.owner, api.name, wrapper, api.label);
    }
  }

  probeWindow.__mcp_jsvmp_uninstall = () => {
    active = false;
    const restored: string[] = [];
    for (let index = restoreActions.length - 1; index >= 0; index -= 1) {
      const label = restoreActions[index]();
      if (label) restored.push(label);
    }
    restoreActions.length = 0;
    probeWindow.__mcp_jsvmp_installed = false;
    probeWindow.__mcp_proxy_originals = {};
    return {restored};
  };

  try {
    console.log(
      `[JSVMP] Probe installed. scriptUrl=${config.scriptUrl || '(all)'} ` +
        `calls=${config.trackCalls} props=${config.trackProps} ` +
        `reflect=${config.trackReflect} proxyObjects=${config.proxyObjects.length}`,
    );
  } catch {}
  active = true;
}

function installJsvmpTransparentHook(
  config: JsvmpTransparentHookOptions,
): void {
  const probeWindow = window as JsvmpProbeWindow;
  if (probeWindow.__mcp_jsvmp_transparent_installed) {
    try {
      console.log('[JSVMP-T] Already installed, skipping');
    } catch {}
    return;
  }

  probeWindow.__mcp_jsvmp_transparent_installed = true;
  probeWindow.__mcp_jsvmp_log = probeWindow.__mcp_jsvmp_log ?? [];
  probeWindow.__mcp_transparent_originals = [];

  const OriginalError = Error;
  const originalJsonStringify = JSON.stringify;
  const originalDateNow = Date.now;
  const originalFunctionToString = Function.prototype.toString;
  const originalDefineProperty = Object.defineProperty;
  const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
  const originalGetPrototypeOf = Object.getPrototypeOf;
  const originalReflectApply = Reflect.apply;

  function preview(value: unknown, maxLength = 150): string {
    try {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      if (typeof value === 'function') {
        return `[Function ${value.name || ''}]`;
      }
      if (typeof value === 'object') {
        const serialized = originalJsonStringify(value);
        if (typeof serialized === 'string') {
          return serialized.length > maxLength
            ? `${serialized.substring(0, maxLength)}...`
            : serialized;
        }
      }
      const text = String(value);
      return text.length > maxLength
        ? `${text.substring(0, maxLength)}...`
        : text;
    } catch {
      try {
        return String(value).substring(0, maxLength);
      } catch {
        return '[unprintable]';
      }
    }
  }

  function shortStack(): string {
    try {
      const stack = new OriginalError().stack ?? '';
      return stack.split('\n').slice(2, 8).join('\n');
    } catch {
      return '';
    }
  }

  function inTargetScript(stack: string): boolean {
    return !config.scriptUrl || stack.includes(config.scriptUrl);
  }

  function log(entry: Record<string, unknown>): void {
    const entries = probeWindow.__mcp_jsvmp_log!;
    if (entries.length >= config.maxEntries) return;
    entry.ts = originalReflectApply(originalDateNow, Date, []);
    entries.push(entry);
  }

  function tapGetter(ownerName: string, owner: object, prop: string): boolean {
    try {
      const descriptor = originalGetOwnPropertyDescriptor(owner, prop);
      if (
        !descriptor ||
        descriptor.configurable === false ||
        typeof descriptor.get !== 'function'
      ) {
        return false;
      }

      const originalGetter = descriptor.get;
      let originalSource: string;
      try {
        originalSource = originalReflectApply(
          originalFunctionToString,
          originalGetter,
          [],
        );
      } catch {
        originalSource = `function ${prop}() { [native code] }`;
      }

      const tappedGetter = function (this: unknown): unknown {
        const value = originalReflectApply(originalGetter, this, []);
        try {
          const stack = shortStack();
          if (inTargetScript(stack)) {
            log({
              type: 'transparent_get',
              owner: ownerName,
              key: prop,
              value: preview(value),
              stack,
            });
          }
        } catch {}
        return value;
      };

      try {
        originalDefineProperty(tappedGetter, 'toString', {
          value: () => originalSource,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch {}
      try {
        originalDefineProperty(tappedGetter, 'name', {
          value: originalGetter.name || prop,
          writable: false,
          configurable: true,
        });
      } catch {}

      probeWindow.__mcp_transparent_originals!.push({
        owner,
        prop,
        descriptor,
      });
      originalDefineProperty(owner, prop, {
        get: tappedGetter,
        set: descriptor.set,
        configurable: true,
        enumerable: descriptor.enumerable,
      });
      return true;
    } catch {
      return false;
    }
  }

  const targets: Array<[string, object]> = [];
  function addTarget(name: string, value: unknown): void {
    if (value && typeof value === 'object') targets.push([name, value]);
  }

  try {
    addTarget('Navigator', originalGetPrototypeOf(navigator));
  } catch {}
  try {
    addTarget('Screen', originalGetPrototypeOf(screen));
  } catch {}
  try {
    addTarget('History', originalGetPrototypeOf(history));
  } catch {}
  try {
    addTarget('Performance', originalGetPrototypeOf(performance));
  } catch {}
  try {
    addTarget('Location', originalGetPrototypeOf(location));
  } catch {}
  try {
    const htmlDocumentPrototype = originalGetPrototypeOf(document);
    addTarget('HTMLDocument', htmlDocumentPrototype);
    addTarget('Document', originalGetPrototypeOf(htmlDocumentPrototype));
  } catch {}

  let total = 0;
  let tapped = 0;
  for (const [ownerName, owner] of targets) {
    let properties: string[];
    try {
      properties = originalGetOwnPropertyNames(owner);
    } catch {
      continue;
    }
    for (const property of properties) {
      if (
        property === 'constructor' ||
        property === '__proto__' ||
        property === 'toString' ||
        property === 'valueOf'
      ) {
        continue;
      }
      total += 1;
      if (tapGetter(ownerName, owner, property)) tapped += 1;
    }
  }

  probeWindow.__mcp_transparent_uninstall = () => {
    const restored: string[] = [];
    const originals = probeWindow.__mcp_transparent_originals ?? [];
    for (let index = originals.length - 1; index >= 0; index -= 1) {
      const original = originals[index];
      try {
        originalDefineProperty(
          original.owner,
          original.prop,
          original.descriptor,
        );
        restored.push(original.prop);
      } catch {}
    }
    probeWindow.__mcp_jsvmp_transparent_installed = false;
    probeWindow.__mcp_transparent_originals = [];
    return {restored};
  };

  try {
    console.log(
      `[JSVMP-T] Transparent probe installed. Tapped ${tapped}/${total} ` +
        `getters. scriptUrl=${config.scriptUrl || '(all)'}`,
    );
  } catch {}
}

export function buildJsvmpProxyHook(options: JsvmpProxyHookOptions): string {
  return `(${installJsvmpProxyHook.toString()})(${JSON.stringify(options)});`;
}

export function buildJsvmpTransparentHook(
  options: JsvmpTransparentHookOptions,
): string {
  return `(${installJsvmpTransparentHook.toString()})(${JSON.stringify(options)});`;
}
