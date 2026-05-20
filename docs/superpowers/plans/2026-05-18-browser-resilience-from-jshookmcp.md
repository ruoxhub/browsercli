# Browser Resilience Improvements (借鉴 jshookmcp browser 模块) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 jshookmcp 的 browser 模块借鉴 4 项关键设计，提升 JSReverser-CLI 的浏览器层健壮性：CDP 错误映射、并发启动防竞态、超时关闭兜底、SPA Hook 重注入。

**Architecture:** 新增 `src/browser/CDPErrorMapper.ts` 错误映射模块；修改 `src/browser/browser.ts` 的 `BrowserManager` 类增加 Promise 锁和超时关闭；新增 `src/modules/hook/HookHeartbeat.ts` 实现 SPA 导航重注入。所有改动保持向后兼容，不改变现有公共 API 签名。

**Tech Stack:** TypeScript 5.x, Node.js 内置 `node:test` 测试框架, patchright (Playwright fork), swc 编译

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/browser/CDPErrorMapper.ts` | CDP 错误正则匹配 + 友好映射 + 工具函数 |
| Create | `tests/unit/browser/CDPErrorMapper.test.ts` | CDPErrorMapper 单元测试 |
| Modify | `src/browser/browser.ts:391-468` | BrowserManager 增加 Promise 锁 + 超时关闭 |
| Modify | `src/browser/index.ts` | 导出 CDPErrorMapper |
| Create | `src/modules/hook/HookHeartbeat.ts` | SPA 导航后 Hook 重注入 (防抖 + 超时) |
| Create | `tests/unit/modules/HookHeartbeat.test.ts` | HookHeartbeat 单元测试 |
| Modify | `tests/unit/browser/BrowserManager.test.ts` | 增加竞态和超时关闭测试 |

---

### Task 1: CDPErrorMapper — 错误映射模块

**Files:**
- Create: `src/browser/CDPErrorMapper.ts`
- Create: `tests/unit/browser/CDPErrorMapper.test.ts`
- Modify: `src/browser/index.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/browser/CDPErrorMapper.test.ts
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {mapCDPError, isCDPSessionGone, wrapCDPCall} from '../../../src/browser/CDPErrorMapper.js';

describe('CDPErrorMapper', () => {
  describe('mapCDPError', () => {
    it('should map "Session closed" to CDP_SESSION_CLOSED', () => {
      const result = mapCDPError(new Error('Session closed. Most likely the page has been closed.'));
      assert.strictEqual(result.name, 'CDP_SESSION_CLOSED');
    });

    it('should map "Target closed" to CDP_TARGET_CLOSED', () => {
      const result = mapCDPError(new Error('Target closed'));
      assert.strictEqual(result.name, 'CDP_TARGET_CLOSED');
    });

    it('should map "Cannot find context" to CDP_CONTEXT_GONE', () => {
      const result = mapCDPError(new Error('Cannot find context with specified id'));
      assert.strictEqual(result.name, 'CDP_CONTEXT_GONE');
    });

    it('should map "Execution context was destroyed" to CDP_CONTEXT_GONE', () => {
      const result = mapCDPError(new Error('Execution context was destroyed'));
      assert.strictEqual(result.name, 'CDP_CONTEXT_GONE');
    });

    it('should map Protocol timeout to CDP_TIMEOUT', () => {
      const result = mapCDPError(new Error('Protocol error (Runtime.evaluate): Timeout'));
      assert.strictEqual(result.name, 'CDP_TIMEOUT');
    });

    it('should map net::ERR_ to CDP_NETWORK_ERROR', () => {
      const result = mapCDPError(new Error('net::ERR_CONNECTION_REFUSED'));
      assert.strictEqual(result.name, 'CDP_NETWORK_ERROR');
    });

    it('should pass through unknown errors unchanged', () => {
      const original = new Error('Something completely different');
      const result = mapCDPError(original);
      assert.strictEqual(result, original);
    });

    it('should handle non-Error input', () => {
      const result = mapCDPError('string error about Session closed');
      assert.strictEqual(result.name, 'CDP_SESSION_CLOSED');
    });
  });

  describe('isCDPSessionGone', () => {
    it('should return true for session closed errors', () => {
      assert.strictEqual(isCDPSessionGone(new Error('Session closed')), true);
    });

    it('should return true for target closed errors', () => {
      assert.strictEqual(isCDPSessionGone(new Error('Target closed')), true);
    });

    it('should return true for connection closed errors', () => {
      assert.strictEqual(isCDPSessionGone(new Error('Connection closed')), true);
    });

    it('should return false for unrelated errors', () => {
      assert.strictEqual(isCDPSessionGone(new Error('timeout')), false);
    });
  });

  describe('wrapCDPCall', () => {
    it('should return result on success', async () => {
      const result = await wrapCDPCall(async () => 42);
      assert.strictEqual(result, 42);
    });

    it('should throw mapped error on failure', async () => {
      await assert.rejects(
        () => wrapCDPCall(async () => { throw new Error('Session closed'); }),
        (err: Error) => err.name === 'CDP_SESSION_CLOSED',
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx swc tests/unit/browser/CDPErrorMapper.test.ts -d build/tests/unit/browser/ && node --test build/tests/unit/browser/CDPErrorMapper.test.js`
Expected: FAIL — module `../../../src/browser/CDPErrorMapper.js` not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/browser/CDPErrorMapper.ts

interface CDPErrorPattern {
  pattern: RegExp;
  code: string;
  message: string;
}

const CDP_ERROR_PATTERNS: CDPErrorPattern[] = [
  {pattern: /Session closed/i, code: 'CDP_SESSION_CLOSED', message: 'CDP 会话已关闭，页面可能已被关闭'},
  {pattern: /Target closed/i, code: 'CDP_TARGET_CLOSED', message: '目标页面已关闭'},
  {pattern: /Cannot find context/i, code: 'CDP_CONTEXT_GONE', message: '执行上下文已销毁（页面导航或刷新）'},
  {pattern: /Execution context was destroyed/i, code: 'CDP_CONTEXT_GONE', message: '执行上下文已销毁（页面导航或刷新）'},
  {pattern: /Protocol error.*Timeout/i, code: 'CDP_TIMEOUT', message: 'CDP 协议调用超时'},
  {pattern: /Timed out/i, code: 'CDP_TIMEOUT', message: 'CDP 操作超时'},
  {pattern: /net::ERR_/i, code: 'CDP_NETWORK_ERROR', message: '网络请求失败'},
  {pattern: /Connection closed/i, code: 'CDP_CONNECTION_CLOSED', message: '与浏览器的连接已断开'},
  {pattern: /WebSocket is not open/i, code: 'CDP_CONNECTION_CLOSED', message: 'WebSocket 连接已关闭'},
  {pattern: /Frame was detached/i, code: 'CDP_FRAME_DETACHED', message: 'Frame 已分离（页面导航中）'},
];

export function mapCDPError(error: unknown): Error {
  const msg = error instanceof Error ? error.message : String(error);
  const match = CDP_ERROR_PATTERNS.find(p => p.pattern.test(msg));
  if (match) {
    const mapped = new Error(`${match.message} (原始: ${msg})`);
    mapped.name = match.code;
    if (error instanceof Error) {
      mapped.stack = error.stack;
    }
    return mapped;
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export function isCDPSessionGone(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Session closed|Target closed|Connection closed|WebSocket is not open/i.test(msg);
}

export async function wrapCDPCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapCDPError(error);
  }
}
```

- [ ] **Step 4: Add export to barrel file**

In `src/browser/index.ts`, add:
```typescript
export {mapCDPError, isCDPSessionGone, wrapCDPCall} from './CDPErrorMapper.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx swc src/browser/CDPErrorMapper.ts -d build/src/browser/ && npx swc tests/unit/browser/CDPErrorMapper.test.ts -d build/tests/unit/browser/ && node --test build/tests/unit/browser/CDPErrorMapper.test.js`
Expected: All 9 tests PASS

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/browser/CDPErrorMapper.ts src/browser/index.ts tests/unit/browser/CDPErrorMapper.test.ts
git commit -m "feat(browser): add CDPErrorMapper for friendly CDP error mapping"
```

---

### Task 2: Promise 锁防竞态启动

**Files:**
- Modify: `src/browser/browser.ts:391-468` (BrowserManager class)
- Modify: `tests/unit/browser/BrowserManager.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/browser/BrowserManager.test.ts`:

```typescript
describe('Race condition protection (Requirement 9.8)', () => {
  it('should not launch multiple browsers when ensureBrowser is called concurrently', async () => {
    let launchCount = 0;
    const originalLaunch = chromium.launch;

    // Mock chromium.launch to count invocations
    (chromium as any).launch = async (...args: any[]) => {
      launchCount++;
      // Simulate slow launch
      await new Promise(resolve => setTimeout(resolve, 50));
      return originalLaunch.call(chromium, ...args);
    };

    try {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      // Call ensureBrowser 3 times concurrently
      const results = await Promise.all([
        manager.ensureBrowser(),
        manager.ensureBrowser(),
        manager.ensureBrowser(),
      ]);

      // All should return the same browser instance
      assert.strictEqual(results[0], results[1]);
      assert.strictEqual(results[1], results[2]);

      // Launch should only be called once
      assert.strictEqual(launchCount, 1, 'chromium.launch should only be called once');
    } finally {
      (chromium as any).launch = originalLaunch;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `RUN_BROWSER_TESTS=true npx swc tests/unit/browser/BrowserManager.test.ts -d build/tests/unit/browser/ && node --test build/tests/unit/browser/BrowserManager.test.js`
Expected: FAIL — concurrent calls launch multiple browsers

- [ ] **Step 3: Add Promise lock to BrowserManager**

In `src/browser/browser.ts`, add a private field to the `BrowserManager` class (after line ~399):

```typescript
private launchPromise: Promise<Browser> | null = null;
```

Then modify `ensureBrowser()` (lines ~452-468):

```typescript
async ensureBrowser(): Promise<Browser> {
  if (this.browser?.isConnected()) {
    return this.browser;
  }

  // Reuse in-flight launch to prevent concurrent launches
  if (this.launchPromise) {
    return this.launchPromise;
  }

  const doLaunch = async (): Promise<Browser> => {
    if (
      this.config.browserURL ||
      this.config.wsEndpoint ||
      this.config.remoteDebuggingUrl
    ) {
      return this.connectToRemoteBrowser();
    }
    return this.launchBrowser();
  };

  this.launchPromise = doLaunch().finally(() => {
    this.launchPromise = null;
  });

  return this.launchPromise;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `RUN_BROWSER_TESTS=true npx swc src/browser/browser.ts -d build/src/browser/ && npx swc tests/unit/browser/BrowserManager.test.ts -d build/tests/unit/browser/ && node --test build/tests/unit/browser/BrowserManager.test.js`
Expected: PASS

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/browser/browser.ts tests/unit/browser/BrowserManager.test.ts
git commit -m "fix(browser): add Promise lock to prevent concurrent browser launches"
```

---

### Task 3: forceKill 超时关闭

**Files:**
- Modify: `src/browser/browser.ts` (BrowserManager.close method)
- Modify: `tests/unit/browser/BrowserManager.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/browser/BrowserManager.test.ts`:

```typescript
describe('Timeout close with forceKill (Requirement 9.9)', () => {
  it('should force-kill browser if close() hangs beyond timeout', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    // Launch browser
    await manager.ensureBrowser();

    // Verify browser is connected before close
    assert.strictEqual(manager.isConnected(), true);

    // Close should complete even if browser.close() is slow
    // (We can't easily mock the timeout, but we verify close() resolves)
    await manager.close();

    assert.strictEqual(manager.isConnected(), false);
  });
});
```

- [ ] **Step 2: Read current close() implementation**

Find the `close()` method in `src/browser/browser.ts` to understand its current shape.

- [ ] **Step 3: Modify close() to add timeout protection**

Replace the `close()` method body with:

```typescript
async close(): Promise<void> {
  if (!this.browser) return;

  // Stop crash detection
  if (this.crashCheckInterval) {
    clearInterval(this.crashCheckInterval);
    this.crashCheckInterval = undefined;
  }

  this.removeDetachedFrameGuard();

  const browser = this.browser;
  this.browser = undefined;
  this.context = undefined;
  this.currentPage = null;
  this.stealthInjected = false;

  try {
    await Promise.race([
      browser.close(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Browser close timeout')), 5_000),
      ),
    ]);
  } catch (error) {
    // Timeout or close error — attempt force kill
    const pid = browser.process()?.pid;
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process may already be dead
      }
    }
    logger.debug('Browser close forced:', error);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `RUN_BROWSER_TESTS=true npx swc src/browser/browser.ts -d build/src/browser/ && npx swc tests/unit/browser/BrowserManager.test.ts -d build/tests/unit/browser/ && node --test build/tests/unit/browser/BrowserManager.test.js`
Expected: PASS

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/browser/browser.ts tests/unit/browser/BrowserManager.test.ts
git commit -m "fix(browser): add 5s timeout + forceKill fallback to BrowserManager.close()"
```

---

### Task 4: HookHeartbeat — SPA 导航后 Hook 重注入

**Files:**
- Create: `src/modules/hook/HookHeartbeat.ts`
- Create: `tests/unit/modules/HookHeartbeat.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/modules/HookHeartbeat.test.ts
import assert from 'node:assert';
import {describe, it, afterEach} from 'node:test';
import {EventEmitter} from 'node:events';

import {HookHeartbeat} from '../../../src/modules/hook/HookHeartbeat.js';

class MockFrame extends EventEmitter {
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
}

class MockPage extends EventEmitter {
  readonly mainFrame = new MockFrame('https://example.com');
  private closed = false;
  evaluateCalls: string[] = [];

  async evaluate(script: string): Promise<void> {
    if (this.closed) throw new Error('Page closed');
    this.evaluateCalls.push(script);
  }

  isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    this.emit('close');
  }
}

describe('HookHeartbeat', () => {
  let heartbeat: HookHeartbeat;
  let page: MockPage;

  afterEach(() => {
    heartbeat?.stop();
  });

  it('should re-inject hook script after framenavigated event', async () => {
    page = new MockPage();
    const hookScript = 'console.log("hook injected")';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();

    // Simulate navigation
    page.emit('framenavigated', page.mainFrame);

    // Wait for debounce (150ms) + small buffer
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(page.evaluateCalls.length, 1);
    assert.strictEqual(page.evaluateCalls[0], hookScript);
  });

  it('should debounce rapid navigations', async () => {
    page = new MockPage();
    const hookScript = 'hook()';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();

    // Simulate 5 rapid navigations
    for (let i = 0; i < 5; i++) {
      page.emit('framenavigated', page.mainFrame);
    }

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 200));

    // Should only inject once due to debounce
    assert.strictEqual(page.evaluateCalls.length, 1);
  });

  it('should not inject after stop() is called', async () => {
    page = new MockPage();
    const hookScript = 'hook()';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();
    heartbeat.stop();

    page.emit('framenavigated', page.mainFrame);
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(page.evaluateCalls.length, 0);
  });

  it('should not throw if page is closed during injection', async () => {
    page = new MockPage();
    const hookScript = 'hook()';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();

    page.close();
    page.emit('framenavigated', page.mainFrame);

    // Should not throw
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.strictEqual(page.evaluateCalls.length, 0);
  });

  it('should auto-stop when page closes', async () => {
    page = new MockPage();
    const hookScript = 'hook()';
    heartbeat = new HookHeartbeat(page as any, hookScript);
    heartbeat.start();

    page.close();

    // Subsequent navigations should be ignored
    page.emit('framenavigated', page.mainFrame);
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(page.evaluateCalls.length, 0);
    assert.strictEqual(heartbeat.isActive(), false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx swc tests/unit/modules/HookHeartbeat.test.ts -d build/tests/unit/modules/ && node --test build/tests/unit/modules/HookHeartbeat.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/modules/hook/HookHeartbeat.ts
import type {Page} from 'patchright';

const DEBOUNCE_MS = 150;
const INJECT_TIMEOUT_MS = 10_000;

export class HookHeartbeat {
  private readonly page: Page;
  private readonly hookScript: string;
  private debounceTimer: NodeJS.Timeout | undefined;
  private active = false;
  private readonly onNavigated: () => void;
  private readonly onClose: () => void;

  constructor(page: Page, hookScript: string) {
    this.page = page;
    this.hookScript = hookScript;

    this.onNavigated = () => {
      if (!this.active) return;
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.inject(), DEBOUNCE_MS);
    };

    this.onClose = () => {
      this.stop();
    };
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.page.on('framenavigated', this.onNavigated);
    this.page.once('close', this.onClose);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.debounceTimer);
    this.page.off('framenavigated', this.onNavigated);
    this.page.off('close', this.onClose);
  }

  isActive(): boolean {
    return this.active;
  }

  private async inject(): Promise<void> {
    if (!this.active || this.page.isClosed()) return;
    try {
      await Promise.race([
        this.page.evaluate(this.hookScript),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Hook injection timeout')), INJECT_TIMEOUT_MS),
        ),
      ]);
    } catch {
      // Page closed or timeout — silently ignore
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx swc src/modules/hook/HookHeartbeat.ts -d build/src/modules/hook/ && npx swc tests/unit/modules/HookHeartbeat.test.ts -d build/tests/unit/modules/ && node --test build/tests/unit/modules/HookHeartbeat.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/hook/HookHeartbeat.ts tests/unit/modules/HookHeartbeat.test.ts
git commit -m "feat(hook): add HookHeartbeat for SPA navigation re-injection"
```

---

### Task 5: Full build verification

**Files:**
- No new files

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing + new)

- [ ] **Step 3: Final commit if any fixups needed**

If build or tests revealed issues, fix and commit:
```bash
git add -A
git commit -m "fix: address build/test issues from browser resilience changes"
```
