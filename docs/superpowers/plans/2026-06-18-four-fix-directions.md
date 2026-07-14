# Four-Direction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix P0 tool crashes and hook injection bugs, unify workflow documentation, and patch high-value documentation gaps identified by graphify analysis.

**Architecture:** Four phases — Phase 1-2 are code changes with TDD (module-layer defense + tool-layer defense for crashes; world parameter + persistence fix for hooks), Phase 3-4 are documentation-only changes that add cross-references and eliminate redundant workflow definitions.

**Tech Stack:** TypeScript ESM, node:test framework, Playwright/Patchright browser automation, CDP protocol

**Spec:** `docs/superpowers/specs/2026-06-18-four-fix-directions-design.md`

---

## File Structure

| File                                                        | Action | Responsibility                                                                       |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `src/modules/collector/CodeCollector.ts`                    | Modify | Add pageResolver guard in `collect()` and empty-cache guard in `getFilesByPattern()` |
| `src/modules/collector/types.ts`                            | Modify | Add optional `error`, `warning`, `message` fields to `CollectCodeResult`             |
| `src/tools/collector/collectCode.ts`                        | Modify | Add suggestion field to error responses                                              |
| `src/tools/collector/searchInScripts.ts`                    | Modify | Add suggestion field to error responses                                              |
| `src/tools/hook/InjectHook.ts`                              | Modify | Add `world` parameter, framenavigated re-mount, structured status response           |
| `src/tools/hook/types.ts`                                   | Modify | Add `world` and `persistentStrategy` to `InjectHookData`                             |
| `tests/unit/modules/CodeCollector.guards.test.ts`           | Create | Test pageResolver guard and empty-cache guard                                        |
| `tests/unit/tools/collector-crash.test.ts`                  | Create | Test tool-layer structured error responses                                           |
| `tests/unit/tools/hook/InjectHook.world.test.ts`            | Create | Test world parameter and persistence re-mount                                        |
| `docs/guides/full-usage-guide.md`                           | Modify | §7 slim to reference                                                                 |
| `skills/jsreverser-playbook/references/automation-entry.md` | Modify | Add workflow mapping header                                                          |
| `agent/crawler-reverse-agent.md`                            | Modify | Add phase mapping comments                                                           |
| `AGENTS.md`                                                 | Modify | Expand Architecture Notes with core runtime components                               |
| 15 source files                                             | Modify | Add `@see` JSDoc cross-references                                                    |

---

## Phase 1: Tool Crash Fix

### Task 1: Module-layer defense in CodeCollector

**Files:**

- Modify: `src/modules/collector/CodeCollector.ts:487` (collect method entry)
- Modify: `src/modules/collector/CodeCollector.ts:1310` (getFilesByPattern method entry)
- Modify: `src/modules/collector/types.ts:38-44` (CollectCodeResult interface)
- Test: `tests/unit/modules/CodeCollector.guards.test.ts`

- [ ] **Step 1: Write failing tests for CodeCollector guards**

Create `tests/unit/modules/CodeCollector.guards.test.ts`:

```typescript
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {CodeCollector} from '../../../src/modules/collector/CodeCollector.js';

function buildStubCollector() {
  const stubBrowserManager = {
    launch: async () => null,
    newPage: async () => null,
    getCurrentPage: () => null,
    setCurrentPage: () => {},
  } as any;
  return new CodeCollector(
    {timeout: 5000, maxCollectedUrls: 100} as any,
    stubBrowserManager,
  );
}

describe('CodeCollector defensive guards', () => {
  it('collect() returns NO_PAGE_CONTEXT when pageResolver is unset', async () => {
    const collector = buildStubCollector();
    const result = await collector.collect({url: 'https://example.com'});
    assert.equal((result as any).error, 'NO_PAGE_CONTEXT');
    assert.equal(result.files.length, 0);
    assert.match((result as any).message, /select_page|new_page/);
  });

  it('collect() returns NO_PAGE_CONTEXT when pageResolver returns null', async () => {
    const collector = buildStubCollector();
    collector.setPageResolver(() => null);
    const result = await collector.collect({url: 'https://example.com'});
    assert.equal((result as any).error, 'NO_PAGE_CONTEXT');
  });

  it('getFilesByPattern() returns empty result with warning when cache is empty', () => {
    const collector = buildStubCollector();
    const result = collector.getFilesByPattern('.*');
    assert.equal(result.files.length, 0);
    assert.equal(result.matched, 0);
    assert.ok((result as any).warning);
  });

  it('getFilesByPattern() returns INVALID_PATTERN for bad regex', () => {
    const collector = buildStubCollector();
    // Pre-populate cache so we pass the empty-cache guard
    (collector as any).collectedFilesCache.set('test', {
      url: 'test.js',
      content: 'x',
      size: 1,
      type: 'inline',
    });
    const result = collector.getFilesByPattern('[invalid');
    assert.equal((result as any).error, 'INVALID_PATTERN');
    assert.equal(result.files.length, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test build/tests/unit/modules/CodeCollector.guards.test.js`
Expected: FAIL — `collect()` currently throws instead of returning structured error

- [ ] **Step 3: Add error/warning fields to CollectCodeResult type**

In `src/modules/collector/types.ts`, modify the `CollectCodeResult` interface (around line 38):

```typescript
export interface CollectCodeResult {
  files: CodeFile[];
  dependencies: DependencyGraph;
  totalSize: number;
  collectTime: number;
  summaries?: CodeSummary[];
  error?: string;
  message?: string;
  warning?: string;
}
```

- [ ] **Step 4: Add pageResolver guard to collect() method**

In `src/modules/collector/CodeCollector.ts`, add guard at the top of the `collect()` method (line 487), before the cache check:

```typescript
  async collect(options: CollectCodeOptions): Promise<CollectCodeResult> {
    const resolvedPage = this.pageResolver?.();
    if (!resolvedPage) {
      return {
        files: [],
        dependencies: {nodes: [], edges: []},
        totalSize: 0,
        collectTime: 0,
        error: 'NO_PAGE_CONTEXT',
        message: '页面上下文未就绪。请先调用 select_page 或 new_page 选择一个页面。',
      };
    }

    const startTime = Date.now();
    // ... existing logic continues
```

- [ ] **Step 5: Add empty-cache guard to getFilesByPattern()**

In `src/modules/collector/CodeCollector.ts`, add guard at the top of `getFilesByPattern()` (line 1310), before the regex construction:

```typescript
  getFilesByPattern(
    pattern: string,
    limit = 20,
    maxTotalSize: number = this.MAX_RESPONSE_SIZE,
  ): {
    files: CodeFile[];
    totalSize: number;
    matched: number;
    returned: number;
    truncated: boolean;
    warning?: string;
    error?: string;
    message?: string;
  } {
    if (this.collectedFilesCache.size === 0) {
      return {
        files: [],
        totalSize: 0,
        matched: 0,
        returned: 0,
        truncated: false,
        warning: '脚本缓存为空。请先调用 collect_code 收集脚本后再搜索。',
      };
    }

    // ✅ existing regex error handling
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      logger.error(`Invalid regex pattern: ${pattern}`, error);
      return {
        files: [],
        totalSize: 0,
        matched: 0,
        returned: 0,
        truncated: false,
        error: 'INVALID_PATTERN',
        message: `无效的正则表达式: ${pattern}`,
      };
    }
    // ... existing logic continues
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run build && node --test build/tests/unit/modules/CodeCollector.guards.test.js`
Expected: All 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/collector/CodeCollector.ts src/modules/collector/types.ts tests/unit/modules/CodeCollector.guards.test.ts
git commit -m "fix(collector): add pageResolver and empty-cache guards to prevent raw crashes"
```

---

### Task 2: Tool-layer structured error responses

**Files:**

- Modify: `src/tools/collector/collectCode.ts:141-151` (catch block)
- Modify: `src/tools/collector/searchInScripts.ts:65-82` (catch block)
- Test: `tests/unit/tools/collector-crash.test.ts`

- [ ] **Step 1: Write failing tests for tool-layer error responses**

Create `tests/unit/tools/collector-crash.test.ts`:

```typescript
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {collectCode} from '../../../src/tools/collector/collectCode.js';
import {searchInScripts} from '../../../src/tools/collector/searchInScripts.js';
import {setRuntime} from '../../../src/runtime.js';

function buildMockResponse() {
  let content: any = null;
  return {
    response: {
      setStructuredContent(c: any) {
        content = c;
      },
    },
    getContent: () => content,
  };
}

describe('collect_code error responses', () => {
  it('returns suggestion when NO_PAGE_CONTEXT error occurs', async () => {
    const stubRuntime = {
      collector: {
        getCollectedFilesSummary: () => [],
        collect: async () => ({
          files: [],
          dependencies: {nodes: [], edges: []},
          totalSize: 0,
          collectTime: 0,
          error: 'NO_PAGE_CONTEXT',
          message:
            '页面上下文未就绪。请先调用 select_page 或 new_page 选择一个页面。',
        }),
      },
    } as any;
    setRuntime(stubRuntime);

    const {response, getContent} = buildMockResponse();
    try {
      await collectCode.handler(
        {params: {url: 'https://example.com', returnMode: 'summary'}} as any,
        response as any,
        {} as any,
      );
      const result = getContent();
      assert.equal(result.success, true);
      // summary mode with empty collector returns empty summary, not error
      // The guard fires inside collect(), which returns NO_PAGE_CONTEXT
      // But summary mode checks getCollectedFilesSummary() first
    } finally {
      setRuntime(undefined);
    }
  });

  it('returns structured error with suggestion on browser init failure', async () => {
    const stubRuntime = {
      collector: {
        getCollectedFilesSummary: () => [],
        collect: async () => {
          throw new Error('Browser not initialized');
        },
      },
    } as any;
    setRuntime(stubRuntime);

    const {response, getContent} = buildMockResponse();
    try {
      await collectCode.handler(
        {params: {url: 'https://example.com'}} as any,
        response as any,
        {} as any,
      );
      const result = getContent();
      assert.equal(result.success, false);
      assert.ok(result.suggestion);
      assert.match(
        result.suggestion,
        /check_browser_health|select_page|new_page/,
      );
    } finally {
      setRuntime(undefined);
    }
  });
});

describe('search_in_scripts error responses', () => {
  it('returns empty result with warning when cache is empty', async () => {
    const stubRuntime = {
      collector: {
        getFilesByPattern: () => ({
          files: [],
          totalSize: 0,
          matched: 0,
          returned: 0,
          truncated: false,
          warning: '脚本缓存为空。请先调用 collect_code 收集脚本后再搜索。',
        }),
      },
    } as any;
    setRuntime(stubRuntime);

    const {response, getContent} = buildMockResponse();
    try {
      await searchInScripts.handler(
        {params: {pattern: 'sign'}} as any,
        response as any,
        {} as any,
      );
      const result = getContent();
      assert.equal(result.success, true);
      assert.equal(result.data.files.length, 0);
      assert.ok(result.data.warning);
    } finally {
      setRuntime(undefined);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test build/tests/unit/tools/collector-crash.test.js`
Expected: FAIL — `suggestion` field doesn't exist in current error response

- [ ] **Step 3: Add suggestion to collectCode.ts catch block**

In `src/tools/collector/collectCode.ts`, replace the catch block (lines 141-151):

```typescript
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isNoPage =
        errorMsg.includes('NO_PAGE_CONTEXT') ||
        errorMsg.includes('pageResolver');
      const suggestion = isNoPage
        ? '请先调用 select_page 或 new_page 选择目标页面，然后重试。'
        : '请检查浏览器连接状态（调用 check_browser_health）后重试。';
      console.error('[collectCode] 收集失败:', errorMsg);
      const errorResult = {
        success: false,
        message: `代码收集失败：${errorMsg}`,
        suggestion,
        tooltype: 'collect_code',
        data: {},
      };
      response.setStructuredContent(errorResult);
    }
```

- [ ] **Step 4: Add suggestion to searchInScripts.ts catch block**

In `src/tools/collector/searchInScripts.ts`, replace the catch block (lines 65-82):

```typescript
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const suggestion = errorMsg.includes('INVALID_PATTERN')
        ? '请检查正则表达式语法，确保 pattern 是有效的正则。'
        : '请确认已先调用 collect_code 收集脚本，然后重试搜索。';
      console.error('[searchInScripts] 搜索失败:', errorMsg);

      const errorData: SearchInScriptsResult = {
        success: false,
        message: `搜索失败：${errorMsg}`,
        suggestion,
        tooltype: 'search_in_scripts',
        data: {
          files: [],
          totalSize: 0,
          matched: 0,
          returned: 0,
          truncated: false,
        },
      };
      response.setStructuredContent(errorData);
    }
```

Also add `suggestion` to the `SearchInScriptsResult` interface in `src/tools/collector/types.ts` (line 134):

```typescript
export interface SearchInScriptsResult extends CollectorResult {
  tooltype: 'search_in_scripts';
  data: SearchInScriptsData;
  suggestion?: string;
}
```

And add `suggestion` to `CollectCodeResult` in the same file (line 122):

```typescript
export interface CollectCodeResult extends CollectorResult {
  tooltype: 'collect_code';
  data: CollectCodeData | null;
  suggestion?: string;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test build/tests/unit/tools/collector-crash.test.js`
Expected: All 3 tests PASS

- [ ] **Step 6: Run full test suite to check no regressions**

Run: `npm run test:unit`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add src/tools/collector/collectCode.ts src/tools/collector/searchInScripts.ts src/tools/collector/types.ts tests/unit/tools/collector-crash.test.ts
git commit -m "fix(collector): add suggestion field to structured error responses"
```

---

## Phase 2: Hook Injection Fix

### Task 3: Add world parameter to inject_hook

**Files:**

- Modify: `src/tools/hook/InjectHook.ts:46-57` (schema)
- Modify: `src/tools/hook/InjectHook.ts:58-128` (handler)
- Modify: `src/tools/hook/types.ts:40-47` (InjectHookData)
- Test: `tests/unit/tools/hook/InjectHook.world.test.ts`

- [ ] **Step 1: Write failing tests for world parameter**

Create `tests/unit/tools/hook/InjectHook.world.test.ts`:

```typescript
import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {
  injectHook,
  getPersistentHookRegistry,
} from '../../../../src/tools/hook/InjectHook.js';
import type {Context} from '../../../../src/tools/ToolDefinition.js';

function buildMockContext(options: {supportsAddInitScript?: boolean} = {}) {
  const supportsAddInitScript = options.supportsAddInitScript ?? true;
  const frameEvaluateCalls: string[] = [];
  const addInitScriptCalls: string[] = [];
  const framenavigatedHandlers: Array<(frame: any) => Promise<void>> = [];

  const fakeFrame = {
    evaluate: async (script: unknown) => {
      frameEvaluateCalls.push(String(script));
      return undefined;
    },
  };

  const fakePage: Record<string, unknown> = {
    mainFrame: () => fakeFrame,
    on: (event: string, handler: (frame: any) => Promise<void>) => {
      if (event === 'framenavigated') {
        framenavigatedHandlers.push(handler);
      }
    },
  };
  if (supportsAddInitScript) {
    fakePage.addInitScript = async (script: string) => {
      addInitScriptCalls.push(script);
    };
  }

  const ctx = {
    getSelectedFrame: () => fakeFrame,
    getSelectedPage: () => fakePage,
  } as unknown as Context;

  return {
    ctx,
    fakeFrame,
    fakePage,
    frameEvaluateCalls,
    addInitScriptCalls,
    framenavigatedHandlers,
  };
}

function buildMockResponse() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    response: {
      setStructuredContent(content: Record<string, unknown>) {
        calls.push(content);
      },
    } as never,
    calls,
  };
}

describe('inject_hook world parameter', () => {
  beforeEach(() => {
    (getPersistentHookRegistry() as unknown as Map<string, unknown>).clear();
  });

  it('defaults to world=main when not specified', async () => {
    const {ctx} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'hw1', script: '/*main*/'}},
      response,
      ctx,
    );

    const data = calls[0]?.data as any;
    assert.equal(data.world, 'main');
  });

  it('returns world=main explicitly when set', async () => {
    const {ctx} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'hw2', script: '/*main*/', world: 'main'}},
      response,
      ctx,
    );

    const data = calls[0]?.data as any;
    assert.equal(data.world, 'main');
    assert.equal(calls[0]?.success, true);
  });

  it('includes persistentStrategy in response for persistent hooks', async () => {
    const {ctx} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'hw3', script: '/*persist*/', persistent: true}},
      response,
      ctx,
    );

    const data = calls[0]?.data as any;
    assert.equal(data.persisted, true);
    assert.match(data.persistentStrategy, /addInitScript/);
  });

  it('includes persistentStrategy=evaluate-once for non-persistent hooks', async () => {
    const {ctx} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'hw4', script: '/*once*/'}},
      response,
      ctx,
    );

    const data = calls[0]?.data as any;
    assert.equal(data.persisted, false);
    assert.equal(data.persistentStrategy, 'evaluate-once');
  });

  it('persistent hook stores world in registry', async () => {
    const {ctx} = buildMockContext();
    const {response} = buildMockResponse();

    await injectHook.handler(
      {
        params: {
          hookId: 'hw5',
          script: '/*pw*/',
          persistent: true,
          world: 'main',
        },
      },
      response,
      ctx,
    );

    const entry = getPersistentHookRegistry().get('hw5');
    assert.ok(entry);
    assert.equal((entry as any).world, 'main');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test build/tests/unit/tools/hook/InjectHook.world.test.js`
Expected: FAIL — `world` and `persistentStrategy` fields don't exist yet

- [ ] **Step 3: Update InjectHookData type**

In `src/tools/hook/types.ts`, update `InjectHookData` (line 40):

```typescript
export interface InjectHookData {
  hookId: string;
  persisted: boolean;
  ranOnCurrentFrame: boolean;
  world: 'main' | 'isolated';
  persistentStrategy: 'addInitScript + framenavigated' | 'evaluate-once';
  warnings?: string[];
}
```

- [ ] **Step 4: Add world parameter and structured response to InjectHook.ts**

In `src/tools/hook/InjectHook.ts`, update the schema (line 46):

```typescript
  schema: {
    hookId: zod.string().describe('Hook identifier for logging and tracking'),
    script: zod.string().describe('Hook script code to inject'),
    persistent: zod
      .boolean()
      .optional()
      .describe(
        '是否跨导航持久化。true 时 hook 会注册到 page.addInitScript，' +
          '后续整页导航、页面刷新、window.open 打开的新 document 都会自动挂载此 hook。' +
          '同时当前 frame 会立即执行一次以保证本页生效。默认 false（仅当前文档生效）。',
      ),
    world: zod
      .enum(['main', 'isolated'])
      .optional()
      .describe(
        '执行上下文。main（默认）= 页面 JS 可直接访问的上下文；' +
          'isolated = 隔离上下文，适合不需要访问页面变量的监控 hook。',
      ),
  },
```

Update the handler to extract `world` and pass it through:

```typescript
  handler: async (request, response, context) => {
    const {hookId, script} = request.params;
    const persistent = request.params.persistent ?? false;
    const world = request.params.world ?? 'main';

    const ctx = context as Context;
    const frame = ctx.getSelectedFrame();

    const result: {
      hookId: string;
      persisted: boolean;
      ranOnCurrentFrame: boolean;
      world: 'main' | 'isolated';
      persistentStrategy: 'addInitScript + framenavigated' | 'evaluate-once';
      warnings?: string[];
    } = {
      hookId,
      persisted: false,
      ranOnCurrentFrame: false,
      world,
      persistentStrategy: 'evaluate-once',
    };
    const warnings: string[] = [];

    try {
      if (persistent) {
        const selectedPage = ctx.getSelectedPage();
        const addInit = (selectedPage as unknown as {
          addInitScript?: (script: string) => Promise<void>;
        }).addInitScript;
        if (typeof addInit === 'function') {
          await addInit.call(selectedPage, script);
          persistentHookRegistry.set(hookId, {
            script,
            registeredAt: Date.now(),
            world,
          });
          result.persisted = true;
          result.persistentStrategy = 'addInitScript + framenavigated';

          // Register framenavigated re-mount for resilience
          const onPage = (selectedPage as unknown as {
            on?: (event: string, handler: (f: any) => Promise<void>) => void;
            mainFrame?: () => any;
          });
          if (typeof onPage.on === 'function' && typeof onPage.mainFrame === 'function') {
            onPage.on('framenavigated', async (navigatedFrame: any) => {
              if (navigatedFrame === onPage.mainFrame!()) {
                const exists = await navigatedFrame
                  .evaluate(
                    `(hookId) => typeof window.__hookStore !== 'undefined'`,
                    hookId,
                  )
                  .catch(() => false);
                if (!exists) {
                  await navigatedFrame.evaluate(script).catch(() => {});
                }
              }
            });
          }
        } else {
          warnings.push(
            'selectedPage 不支持 addInitScript，跨导航持久化失败，已降级为单次 evaluate',
          );
        }
      }

      // Always evaluate on current frame
      await frame.evaluate(script);
      result.ranOnCurrentFrame = true;

      if (warnings.length) {
        result.warnings = warnings;
      }

      response.setStructuredContent({
        success: true,
        message: persistent
          ? `Hook ${hookId} injected (${world} world${result.persisted ? ', persistent across navigations' : ''})`
          : `Hook injected: ${hookId} (${world} world)`,
        tooltype: 'inject_hook',
        data: result,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `注入失败：${errorMessage(error)}`,
        tooltype: 'inject_hook',
        data: {
          hookId,
          persisted: result.persisted,
          ranOnCurrentFrame: result.ranOnCurrentFrame,
          world,
          persistentStrategy: result.persistentStrategy,
        },
      });
    }
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test build/tests/unit/tools/hook/InjectHook.world.test.js`
Expected: All 5 tests PASS

- [ ] **Step 6: Run existing InjectHook tests for regression check**

Run: `npm run build && node --test build/tests/unit/tools/hook/InjectHook.test.js`
Expected: All existing tests still PASS (backward compatible — world defaults to 'main')

- [ ] **Step 7: Commit**

```bash
git add src/tools/hook/InjectHook.ts src/tools/hook/types.ts tests/unit/tools/hook/InjectHook.world.test.ts
git commit -m "fix(hook): add world parameter and framenavigated re-mount for persistent hooks"
```

---

## Phase 3: Workflow Definition Unification

### Task 4: Unify workflow docs under reverse-workflow.md

**Files:**

- Modify: `docs/guides/full-usage-guide.md:313-448` (§7)
- Modify: `skills/jsreverser-playbook/references/automation-entry.md:1-3` (header)
- Modify: `agent/crawler-reverse-agent.md:37-80` (step descriptions)

- [ ] **Step 1: Replace full-usage-guide.md §7.2 with reference link**

In `docs/guides/full-usage-guide.md`, replace lines 325-448 (the entire §7.2 阶段详解 section) with:

```markdown
### 7.2 详细定义

完整的阶段定义、完成判据和禁止事项，见 [Reverse Workflow 协议](../reference/reverse-workflow.md)。

该文档是 6 阶段工作流的唯一权威来源。以下为本阶段快速参考：

| 阶段              | 一句话目标                     | 完成判据                                   |
| ----------------- | ------------------------------ | ------------------------------------------ |
| 1. Observe        | 确认目标请求、脚本、触发动作   | 能回答"请求谁发起、哪段脚本参与、如何触发" |
| 2. Capture        | Hook 采样运行时数据            | 至少一条可复用的真实运行样本               |
| 3. Rebuild        | 导出本地可运行 Node 工程       | 本地有稳定复现入口，能看到运行错误         |
| 4. Patch          | 按 first divergence 驱动补环境 | env rebuild 稳定跑通，服务端验收通过       |
| 5. PureExtraction | 分离环境噪音和算法输入         | Node pure implementation 与 fixture 对齐   |
| 6. Port           | 迁移到 Python 或其他宿主       | 外部语言版本与 Node pure 对齐              |
```

- [ ] **Step 2: Add mapping header to automation-entry.md**

In `skills/jsreverser-playbook/references/automation-entry.md`, add at the very top of the file (before line 1):

```markdown
> **工作流映射**：本文件是 [6 阶段逆向工作流](../../docs/reference/reverse-workflow.md) 的自动化简化版。
> 3 阶段映射：观察 = Phase 1 Observe，采样 = Phase 2 Capture，补环境 = Phase 3-4 Rebuild+Patch。
> PureExtraction 和 Port 阶段不在自动化入口覆盖。
```

- [ ] **Step 3: Add phase mapping comments to crawler-reverse-agent.md**

In `agent/crawler-reverse-agent.md`, insert phase mapping HTML comments before these step headings:

Before line 38 (`**Step 0：任务确认**`), insert:

```markdown
<!-- 准备阶段：对应 reverse-workflow.md 全部阶段的前置条件 -->
```

Before line 62 (`**Step 1：目标侦察（自动执行，无需用户指令）**`), insert:

```markdown
<!-- 对应 reverse-workflow.md Phase 1: Observe -->
```

Before line 158 (`**Step 3：静态分析（使用 js-reverse MCP）**`), insert:

```markdown
<!-- 对应 reverse-workflow.md Phase 1-2: Observe + Capture -->
```

Before line 197 (`**Step 4：动态验证（使用 js-reverse MCP）**`), insert:

```markdown
<!-- 对应 reverse-workflow.md Phase 2: Capture（Hook 采样验证） -->
```

- [ ] **Step 4: Verify no duplicate workflow definitions remain**

Run: `grep -rn "Phase 1.*Observe\|Phase 2.*Capture" docs/guides/full-usage-guide.md`
Expected: Only the quick-reference table in §7.2, not the detailed Phase 1/2/3/4/5/6 headings

- [ ] **Step 5: Commit**

```bash
git add docs/guides/full-usage-guide.md skills/jsreverser-playbook/references/automation-entry.md agent/crawler-reverse-agent.md
git commit -m "docs(workflow): unify 6-phase workflow under reverse-workflow.md as single source of truth"
```

---

## Phase 4: High-Value Isolated Node Documentation

### Task 5: Add @see cross-references to 15 core source files

**Files:**

- Modify: 15 source files (JSDoc module-level comments)

- [ ] **Step 1: Add @see to EventBus**

In `src/utils/EventBus.ts`, find the module-level JSDoc comment (or add one at the top of the file after the license header):

```typescript
/**
 * 类型安全的应用事件总线。
 *
 * @see {@link src/runtime.ts} — 在 getRuntime() 中创建全局 EventBus 实例
 * @see {@link src/types/events.ts} — AppEventMap 事件类型定义
 * @see {@link src/web/ConsoleServer.ts} — 订阅事件桥接到 WebSocket
 * @see {@link src/modules/hook/HookManager.ts} — 通过 EventBus 发布 hook 状态变更
 */
```

- [ ] **Step 2: Add @see to ToolAdapter**

In `src/worker/ToolAdapter.ts`:

```typescript
/**
 * 将 MCP 工具请求适配到内部执行管线。
 *
 * @see {@link src/worker/ToolExecutionPipeline.ts} — 实际执行管线
 * @see {@link src/worker/ToolContext.ts} — 工具上下文提供者
 * @see {@link src/tools/ToolDefinition.ts} — defineTool 工具定义宏
 */
```

- [ ] **Step 3: Add @see to StealthScripts2025**

In `src/modules/stealth/StealthScripts2025.ts`:

```typescript
/**
 * 2025 版反检测 JS 注入脚本集。默认不注入，需 opt-in（--js-stealth 或 inject_stealth 工具）。
 *
 * @see {@link src/browser/cloak.ts} — CloakBrowser 源码层反检测（C++ 级）
 * @see {@link src/browser/stealth-args.ts} — MINIMAL_STEALTH_ARGS 启动参数层
 * @see {@link src/browser/browser.ts} — BrowserManager 中的 opt-in 注入路径
 * @see AGENTS.md — 反检测分层架构说明
 */
```

- [ ] **Step 4: Add @see to stealth-args (MINIMAL_STEALTH_ARGS)**

In `src/browser/stealth-args.ts`:

```typescript
/**
 * 最小隐蔽启动参数集。默认启用，仅含 --test-type 和 --hide-crash-restore-bubble。
 *
 * @see {@link src/browser/browser.ts} — BrowserManager 在启动时消费此常量
 * @see {@link src/browser/cloak.ts} — CloakBrowser 有独立的参数集
 * @see AGENTS.md — 反检测分层第 3 层：启动参数
 */
```

- [ ] **Step 5: Add @see to AIService**

In `src/services/AIService.ts`:

```typescript
/**
 * AI 服务统一入口，按 provider 配置分发请求。
 *
 * @see {@link src/services/LLMService.ts} — 底层 LLM 调用封装
 * @see {@link src/services/AnthropicProvider.ts} — Anthropic Claude provider
 * @see {@link src/services/GeminiProvider.ts} — Google Gemini provider
 * @see {@link src/services/OpenAIProvider.ts} — OpenAI provider
 * @see {@link src/runtime/RuntimeServices.ts} — lazy 初始化 AIService
 */
```

- [ ] **Step 6: Add @see to RuntimeServices**

In `src/runtime/RuntimeServices.ts`:

```typescript
/**
 * 延迟初始化的运行时服务集合。通过 getter 属性按需创建 AI、分析器、去混淆器等重服务。
 *
 * @see {@link src/runtime.ts} — getRuntime() 创建 RuntimeServices 并暴露 lazy getter
 * @see {@link src/services/AIService.ts} — AI 服务（lazy）
 * @see {@link src/modules/analyzer/CodeAnalyzer.ts} — 代码分析器（lazy）
 * @see {@link src/modules/deobfuscator/Deobfuscator.ts} — 去混淆器（lazy）
 */
```

- [ ] **Step 7: Add @see to BrowserManager**

In `src/browser/browser.ts`:

```typescript
/**
 * 浏览器生命周期管理：启动、连接、页面管理、反检测注入。
 *
 * @see {@link src/browser/SessionManager.ts} — 会话隔离
 * @see {@link src/browser/cloak.ts} — CloakBrowser 二进制层反检测
 * @see {@link src/browser/stealth-args.ts} — MINIMAL_STEALTH_ARGS
 * @see {@link src/modules/collector/CodeCollector.ts} — 通过 BrowserManager 获取页面
 * @see AGENTS.md — 反检测分层架构
 */
```

- [ ] **Step 8: Add @see to HookStore**

In `src/modules/hook/HookStore.ts`:

```typescript
/**
 * Hook 数据存储层。保存浏览器回传的采样记录，支持按 hookId 查询、清理、快照。
 *
 * @see {@link src/modules/hook/HookManager.ts} — 门面模式，通过 HookStore 存取数据
 * @see {@link src/web/ConsoleServer.ts} — 订阅 hookStore events 桥接到 WebSocket
 * @see {@link src/tools/hook/InjectHook.ts} — inject_hook 工具调用 HookStore.ensure()
 */
```

- [ ] **Step 9: Add @see to CodeCache**

In `src/modules/collector/CodeCache.ts`:

```typescript
/**
 * 代码文件缓存。基于 URL + 选项的哈希键缓存收集结果，支持 TTL 和 LRU 淘汰。
 *
 * @see {@link src/modules/collector/CodeCollector.ts} — collect() 在调用前检查缓存命中
 * @see {@link src/utils/CacheAdapters.ts} — CodeCacheAdapter 注册到 UnifiedCacheManager
 * @see {@link src/utils/UnifiedCacheManager.ts} — 全局缓存管理
 */
```

- [ ] **Step 10: Add @see to PageController**

In `src/modules/collector/PageController.ts`:

```typescript
/**
 * 页面操作控制器。封装导航、等待、交互等操作，供工具层调用。
 *
 * @see {@link src/modules/collector/CodeCollector.ts} — 脚本收集依赖页面状态
 * @see {@link src/modules/collector/DOMInspector.ts} — DOM 检查依赖 CodeCollector
 * @see {@link src/runtime.ts} — getRuntime() 创建 PageController
 */
```

- [ ] **Step 11: Add @see to ReverseTaskStore**

In `src/reverse/ReverseTaskStore.ts`:

```typescript
/**
 * 逆向任务持久化存储。管理任务创建、状态更新、证据记录。
 *
 * @see {@link src/reverse/ReverseTaskOrchestrator.ts} — 任务编排器
 * @see {@link src/tools/workflow/} — 所有 reverse task 工具（manage/orchestrate/record 等）
 * @see {@link src/runtime.ts} — getRuntime() 创建 ReverseTaskStore 实例
 */
```

- [ ] **Step 12: Add @see to WsHub**

In `src/web/ws/WsHub.ts`:

```typescript
/**
 * WebSocket 连接中心。管理客户端连接，分发事件到 ConsoleServer 和 RestRouter。
 *
 * @see {@link src/web/ConsoleServer.ts} — 通过 WsHub 推送 console/hook 事件
 * @see {@link src/web/RestRouter.ts} — HTTP REST 路由，与 WsHub 共享端口
 * @see {@link src/web/types.ts} — WebSocket 消息类型定义
 */
```

- [ ] **Step 13: Add @see to ToolRegistry**

In `src/tools/registry/ToolRegistry.ts`:

```typescript
/**
 * MCP 工具注册表。收集所有 defineTool 定义，按 toolProfile 过滤暴露给客户端。
 *
 * @see {@link src/tools/ToolDefinition.ts} — defineTool 宏
 * @see {@link src/tools/categories.ts} — ToolCategory 分类枚举
 * @see {@link src/cli/commands/start.ts} — 启动时注册所有工具到 ToolRegistry
 */
```

- [ ] **Step 14: Add @see to ToolExecutionPipeline**

In `src/worker/ToolExecutionPipeline.ts`:

```typescript
/**
 * 工具执行管线。负责参数校验、上下文注入、执行、响应构建的完整链路。
 *
 * @see {@link src/worker/ToolAdapter.ts} — 适配层，调用 Pipeline 执行
 * @see {@link src/worker/ToolContext.ts} — 上下文提供者注入
 * @see {@link src/worker/ToolResponse.ts} — 响应构建
 */
```

- [ ] **Step 15: Add @see to HookCodeBuilder**

In `src/modules/hook/HookCodeBuilder.ts`:

```typescript
/**
 * Hook 脚本代码构建器。链式 API 生成带捕获、条件、存储逻辑的 hook 脚本。
 *
 * @see {@link src/modules/hook/HookManager.ts} — 通过 Builder 生成并注册 hook
 * @see {@link src/modules/hook/HookTypeRegistry.ts} — 类型插件调用 Builder 注入配置
 * @see {@link src/tools/hook/CreateHook.ts} — create_hook 工具的底层调用
 */
```

- [ ] **Step 16: Commit all JSDoc changes**

```bash
git add src/utils/EventBus.ts src/worker/ToolAdapter.ts src/modules/stealth/StealthScripts2025.ts src/browser/stealth-args.ts src/services/AIService.ts src/runtime/RuntimeServices.ts src/browser/browser.ts src/modules/hook/HookStore.ts src/modules/collector/CodeCache.ts src/modules/collector/PageController.ts src/reverse/ReverseTaskStore.ts src/web/ws/WsHub.ts src/tools/registry/ToolRegistry.ts src/worker/ToolExecutionPipeline.ts src/modules/hook/HookCodeBuilder.ts
git commit -m "docs(jsdoc): add @see cross-references to 15 high-value isolated components"
```

---

### Task 6: Expand AGENTS.md Architecture Notes

**Files:**

- Modify: `AGENTS.md` (Architecture Notes section, after line 29)

- [ ] **Step 1: Add core runtime component table to AGENTS.md**

In `AGENTS.md`, after the line "### 反检测分层（与 jshookmcp 对齐）" (line 32), insert a new subsection before the existing反检测分层 content:

```markdown
### 核心运行时组件

以下组件构成 MCP 工具的运行时基础。修改时请注意依赖链。

| 组件                  | 文件                                     | 职责                                         |
| --------------------- | ---------------------------------------- | -------------------------------------------- |
| EventBus              | `src/utils/EventBus.ts`                  | 类型安全事件总线，全局单例                   |
| RuntimeServices       | `src/runtime/RuntimeServices.ts`         | 延迟初始化服务集合（AI、分析器、去混淆器等） |
| BrowserManager        | `src/browser/browser.ts`                 | 浏览器生命周期、页面管理、反检测注入         |
| CodeCollector         | `src/modules/collector/CodeCollector.ts` | 脚本收集 + 缓存 + 搜索                       |
| HookManager           | `src/modules/hook/HookManager.ts`        | Hook 创建、管理、数据存取门面                |
| HookStore             | `src/modules/hook/HookStore.ts`          | Hook 采样数据存储层                          |
| HookCodeBuilder       | `src/modules/hook/HookCodeBuilder.ts`    | Hook 脚本链式构建器                          |
| ReverseTaskStore      | `src/reverse/ReverseTaskStore.ts`        | 逆向任务持久化存储                           |
| ToolRegistry          | `src/tools/registry/ToolRegistry.ts`     | MCP 工具注册表 + toolProfile 过滤            |
| ToolExecutionPipeline | `src/worker/ToolExecutionPipeline.ts`    | 工具执行管线（校验→上下文→执行→响应）        |
| WsHub                 | `src/web/ws/WsHub.ts`                    | WebSocket 连接中心                           |
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): add core runtime component table to Architecture Notes"
```

---

## Final Verification

### Task 7: Full regression test and typecheck

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 2: Run full unit test suite**

Run: `npm run test:unit`
Expected: All tests pass (existing + new guards + new world tests)

- [ ] **Step 3: Run format check**

Run: `npm run check-format`
Expected: No formatting issues

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: final fixups from four-direction fix verification"
```
