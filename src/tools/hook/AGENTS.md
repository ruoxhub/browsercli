# HOOK SYSTEM — src/tools/hook/

## OVERVIEW

Browser-side JavaScript instrumentation for reverse engineering. Each file defines one MCP tool that monkey-patches or proxies a browser API to log, filter, or pause execution.

## WHERE TO LOOK

| Task                      | Location                                                                                   | Notes                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Network hooks             | `hookFetch.ts`, `hookXhrOpen.ts`, `hookXhrSetRequestHeader.ts`                             | Monitor HTTP requests                                                 |
| Storage hooks             | `hookCookie.ts`, `hookLocalStorage.ts`, `hookSessionStorage.ts`                            | Track state persistence                                               |
| Time hooks                | `hookDateNow.ts`, `hookPerformanceNow.ts`                                                  | Freeze or control time                                                |
| Navigation hooks          | `hookHistory.ts`, `hookHistoryGo.ts`, `hookLocationHref.ts`                                | Intercept page navigation                                             |
| Communication hooks       | `hookWebSocket.ts`, `hookFetch.ts`, `hookXhrOpen.ts`                                       | All network channels                                                  |
| Data transformation hooks | `hookJsonParse.ts`, `hookJsonStringify.ts`                                                 | Intercept serialization                                               |
| Console hooks             | `hookConsoleLog.ts`, `hookConsoleTable.ts`, `hookConsoleClear.ts`, `hookConsoleProtect.ts` | Console monitoring and protection                                     |
| Anti-detection            | `antiAntiHook.ts`                                                                          | Counter hook-detection (Function.prototype.toString, iframe proxying) |
| Environment spoofing      | `fixedWindowSize.ts`, `hookRandom.ts`, `hookPromise.ts`                                    | Fake browser properties                                               |
| Misc                      | `hookClose.ts`                                                                             | window.close interception                                             |

## CONVENTIONS

- **Tool pattern**: Every file exports one `defineTool({...})` call, registered in `src/tools/index.ts`
- **Hook code structure**: IIFE string passed to `frame.evaluate()` — always `'use strict'`, always wrapped in `(function(){...})()`
- **Parameter injection**: Use `JSON.stringify()` for arrays/objects, bare interpolation for numbers/booleans
- **Common params**: `showStack?: boolean`, `triggerDebugger?: boolean` appear across most hooks
- **Logging format**: `console.log('描述信息 ---> ' + value)` with arrow separator
- **Console signature**: `[hook_<name>] ✅ <action> installed` at end of IIFE
- **Filtering**: `hasFilter` guard pattern — log everything when no filter, substring-match when filter provided
- **Prototype preservation**: Always restore `__proto__` or use `Object.defineProperty` to maintain prototype chain
- **No barrel export**: Each file imported individually in `src/tools/index.ts` (no `index.ts` in this directory)

## ANTI-PATTERNS

- **NEVER** use `eval()` inside hook IIFE — all params must be interpolated at build time
- **NEVER** skip prototype chain restoration — breaks hook detection countermeasures
- **NEVER** add new hook without registering in `src/tools/index.ts` AND running `npm run docs`
- **DON'T** use arrow functions in hook IIFE — need `this` binding to original context
- **DON'T** hardcode `window` reference without checking iframe cross-origin safety
- **DON'T** mix filter logic with logging — keep `hasFilter` guard separate from `logAndPause`
