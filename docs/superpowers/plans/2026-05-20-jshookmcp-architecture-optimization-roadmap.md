# JSReverser-CLI jshookmcp Architecture Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 `jshookmcp` 的领域微内核、工具发现、执行上下文守卫和声明式工作流设计，在不破坏 JSReverser-CLI 现有工具 API 的前提下补强注册契约、运行时安全和可扩展性。

**Architecture:** 保留当前 `defineTool`、`DomainManifest`、`ToolRegistry`、`ToolExecutionPipeline`、`ToolContextProvider` 和 worker RPC 入口。优化采用增量扩展：先扩展 manifest 元数据和执行管线守卫，再提升工具搜索排序，最后引入声明式 workflow contract 与实验性扩展边界。

**Tech Stack:** TypeScript ESM, Node `node:test`, SWC build, Zod, existing `EventBus`, `ToolRegistry`, `ToolExecutionPipeline`, `DetailedDataManager`, `TokenBudgetManager`.

---

## Evidence Summary

- 当前项目已经有轻量工具注册契约：`src/tools/manifest.ts` 定义 `ToolEntry`、`ToolProfile`、`DomainManifest`，但只包含 `name`、`description`、`profile`、`dependencies`、`tools`。
- 当前 `src/tools/registry/ToolRegistry.ts` 已支持 profile 层级过滤，但没有返回工具依赖、前置条件、场景关键词或 workflow route 元数据。
- 当前 `src/cli/tools-meta.ts` 会从 `GENERATED_DOMAIN_MANIFESTS` 加载 `defineTool` 元信息，`searchTools()` 仍是 name/description 的简单 `includes()` 搜索。
- 当前 `src/worker/ToolExecutionPipeline.ts` 已形成 validate -> load -> execute -> normalize -> offload -> telemetry 的执行链，但没有统一注入页面上下文，也没有重复调用循环告警。
- 当前 `src/types/events.ts` 和 `src/utils/EventBus.ts` 已支持类型化事件与 Zod 校验，可继续承载工具执行、hook、debugger、network 的观测事件。
- 参考项目 `jshookmcp` 的 `DomainManifest` 包含 `kind/version/domain/depKey/profiles/registrations/ensure/prerequisites/toolDependencies/sceneKeywords`，其 `ToolCallContextGuard` 对页面相关工具注入 `_tabContext` 并检测重复工具调用，其 `ToolSearchEngine` 使用 BM25、trigram、param token、scene keywords、affinity graph 等多信号排序。

## File Structure

### New Files

- `src/worker/ToolCallContextGuard.ts`  
  对上下文敏感工具响应注入 `_tabContext`，并在连续重复调用时附加 `repeatWarning`。

- `tests/unit/worker/ToolCallContextGuard.test.ts`  
  覆盖上下文工具识别、页面上下文注入、重复调用告警和非上下文工具直返。

- `src/cli/tool-search-engine.ts`  
  基于现有 `ToolMeta` 实现无新增依赖的 BM25-like + trigram + domain/parameter/scene keyword 加权搜索。

- `tests/unit/cli/tool-search-engine.test.ts`  
  覆盖自然语言 query 到工具排序的核心场景。

- `src/tools/workflow/contracts.ts`  
  定义声明式 workflow contract、step、route、prerequisite 和输入映射。

- `src/tools/workflow/builtin-contracts.ts`  
  为 `observeFlow`、`autoHook`、`rebuildBundle`、`traceSignatureGeneration` 提供首批 workflow contract。

- `tests/unit/tools/workflow/contracts.test.ts`  
  覆盖 workflow contract 结构、工具名存在性、route pattern 和 prerequisite 元数据。

- `src/tools/prerequisites/ToolPrerequisiteChecker.ts`  
  根据 manifest prerequisite 和 `ToolContextProvider` 执行通用前置条件检查。

- `tests/unit/tools/prerequisites/ToolPrerequisiteChecker.test.ts`  
  覆盖 `requiresPage`、`requiresDebugger`、未知条件跳过或失败策略。

### Modified Files

- `src/tools/manifest.ts`  
  扩展 `DomainManifest`，增加可选 `version`、`prerequisites`、`toolDependencies`、`sceneKeywords`、`workflowRule`。

- `src/tools/registry/ToolRegistry.ts`  
  让 `RegisteredToolEntry` 暴露新增 manifest 元数据，并保持旧字段兼容。

- `src/cli/tools-meta.ts`  
  让 `ToolMeta` 携带 `domain`、`profile`、`dependencies`、`prerequisites`、`sceneKeywords`，并将 `searchTools()` 委托给 `tool-search-engine.ts`。

- `src/worker/ToolExecutionPipeline.ts`  
  注入 `ToolCallContextGuard` 和 `ToolPrerequisiteChecker`，在执行前检查前置条件，在 offload 前注入上下文。

- `src/worker/ToolTelemetry.ts`  
  保持现有成功/失败事件；必要时把 prerequisite failure 归入 `tool:error`。

- `src/worker/ToolContextProvider.ts`  
  只在需要时暴露只读 `getContextMeta()`，避免把 guard 直接耦合到 PageManager 内部。

- `src/tools/hook/manifest.ts`  
  添加 hook 工具的 `sceneKeywords`、`toolDependencies` 和关键 prerequisite。

- `src/tools/workflow/manifest.ts`  
  添加 workflow 工具的 `workflowRule`、`toolDependencies` 和 `sceneKeywords`。

- `src/tools/debugger/manifest.ts`  
  添加 debugger 工具的 prerequisite，例如需要页面或 debugger context。

- `src/tools/network/manifest.ts`  
  添加 network 工具关键词和页面相关/原始网络工具的前置条件区分。

---

## Implementation Notes

- 不新增运行时依赖。搜索首版只使用本地 TypeScript 数据结构。
- 不改工具名称、参数 schema 和 MCP/CLI 返回基础结构。
- 修改任何函数、类或方法前，按仓库 GitNexus 规则先运行 impact analysis，并把直接调用方和风险写入执行记录。
- 阶段完成后至少运行 `npm run typecheck`、`npm run check-format`、`npm run test:unit`。
- 当前工作区可能已有用户改动，执行时不得覆盖 unrelated changes。

---

### Task 1: Extend DomainManifest Metadata Contract

**Files:**
- Modify: `src/tools/manifest.ts`
- Modify: `src/tools/registry/ToolRegistry.ts`
- Modify: `src/cli/tools-meta.ts`
- Test: `tests/unit/tools/ToolRegistry.profile.test.ts`

- [ ] **Step 1: Run impact analysis**

Run:

```bash
npx gitnexus impact DomainManifest --direction upstream
npx gitnexus impact ToolRegistry --direction upstream
```

Expected: direct callers include manifest files, generated index consumers, `src/cli/tools-meta.ts`, and registry tests. If risk is HIGH or CRITICAL, record affected modules before editing.

- [ ] **Step 2: Add failing registry metadata test**

Add this case to `tests/unit/tools/ToolRegistry.profile.test.ts`:

```ts
test('listTools carries optional manifest metadata without changing legacy fields', () => {
  const registry = new ToolRegistry([
    {
      name: 'hook',
      description: 'Hook tools',
      profile: 'workflow',
      dependencies: ['browser'],
      version: 1,
      prerequisites: {
        injectHook: [{condition: 'requiresPage', fix: 'Start or attach a browser page first.'}],
      },
      toolDependencies: [
        {from: 'injectHook', to: 'createHook', relation: 'requires', weight: 1},
      ],
      sceneKeywords: {
        injectHook: ['runtime', 'hook', 'instrumentation'],
      },
      tools: [{modulePath: './hook/InjectHook.js', handlerName: 'injectHook'}],
    },
  ]);

  expect(registry.listTools('workflow')).toEqual([
    {
      domain: 'hook',
      modulePath: './hook/InjectHook.js',
      handlerName: 'injectHook',
      profile: 'workflow',
      dependencies: ['browser'],
      prerequisites: [{condition: 'requiresPage', fix: 'Start or attach a browser page first.'}],
      toolDependencies: [
        {from: 'injectHook', to: 'createHook', relation: 'requires', weight: 1},
      ],
      sceneKeywords: ['runtime', 'hook', 'instrumentation'],
    },
  ]);
});
```

- [ ] **Step 3: Run test and confirm failure**

Run:

```bash
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/ToolRegistry.profile.test.js
```

Expected: FAIL because `DomainManifest` and `RegisteredToolEntry` do not expose the new metadata yet.

- [ ] **Step 4: Extend `src/tools/manifest.ts`**

Add:

```ts
export interface ToolPrerequisite {
  condition: 'requiresPage' | 'requiresDebugger' | 'requiresHookStore' | string;
  fix: string;
}

export interface ToolDependency {
  from: string;
  to: string;
  relation: 'requires' | 'precedes' | 'suggests' | 'uses' | 'extends';
  weight?: number;
}

export interface WorkflowRule {
  patterns: readonly RegExp[];
  priority: number;
  tools: readonly string[];
  hint: string;
}
```

Extend `DomainManifest`:

```ts
export interface DomainManifest {
  name: string;
  description: string;
  version?: 1;
  profile?: ToolProfile;
  dependencies?: string[];
  prerequisites?: Record<string, ToolPrerequisite[]>;
  toolDependencies?: ToolDependency[];
  sceneKeywords?: Record<string, string[]>;
  workflowRule?: WorkflowRule;
  tools: ToolEntry[];
}
```

- [ ] **Step 5: Extend `RegisteredToolEntry` and `listTools()`**

In `src/tools/registry/ToolRegistry.ts`, extend the interface:

```ts
export interface RegisteredToolEntry {
  domain: string;
  modulePath: string;
  handlerName: string;
  profile: ToolProfile;
  dependencies?: string[];
  prerequisites?: DomainManifest['prerequisites'][string];
  toolDependencies?: DomainManifest['toolDependencies'];
  sceneKeywords?: string[];
  workflowRule?: DomainManifest['workflowRule'];
}
```

In the mapper, add:

```ts
prerequisites: manifest.prerequisites?.[tool.handlerName],
toolDependencies: manifest.toolDependencies,
sceneKeywords: manifest.sceneKeywords?.[tool.handlerName],
workflowRule: manifest.workflowRule,
```

- [ ] **Step 6: Extend `ToolMeta`**

In `src/cli/tools-meta.ts`, add fields:

```ts
domain: string;
profile: ToolProfile;
dependencies?: string[];
prerequisites?: ToolRegistryEntry['prerequisites'];
toolDependencies?: ToolRegistryEntry['toolDependencies'];
sceneKeywords?: string[];
workflowRule?: ToolRegistryEntry['workflowRule'];
```

Populate them in `loadToolMeta()` from `entry`.

- [ ] **Step 7: Verify**

Run:

```bash
npm run typecheck
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/ToolRegistry.profile.test.js
```

Expected: PASS.

---

### Task 2: Add ToolCallContextGuard to the Execution Pipeline

**Files:**
- Create: `src/worker/ToolCallContextGuard.ts`
- Modify: `src/worker/ToolContextProvider.ts`
- Modify: `src/worker/ToolExecutionPipeline.ts`
- Test: `tests/unit/worker/ToolCallContextGuard.test.ts`
- Test: `tests/unit/worker/ToolExecutionPipeline.test.ts`

- [ ] **Step 1: Run impact analysis**

Run:

```bash
npx gitnexus impact ToolExecutionPipeline --direction upstream
npx gitnexus impact ToolContextProvider --direction upstream
```

Expected: direct callers include worker lifecycle/bootstrap tests and `ToolAdapter`-adjacent execution tests.

- [ ] **Step 2: Write guard unit tests**

Create `tests/unit/worker/ToolCallContextGuard.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {ToolCallContextGuard} from '../../../src/worker/ToolCallContextGuard.js';

test('injects _tabContext into structured object responses for context-sensitive tools', () => {
  const guard = new ToolCallContextGuard(() => ({
    getContextMeta: () => ({
      url: 'https://example.test/app',
      title: 'Example App',
      tabIndex: 0,
      pageId: 'page-1',
    }),
  }));

  guard.recordCall('page_navigate');
  const result = guard.enrichResponse('page_navigate', {
    structuredContent: {ok: true},
  });

  assert.deepEqual(result, {
    structuredContent: {
      ok: true,
      _tabContext: {
        url: 'https://example.test/app',
        title: 'Example App',
        tabIndex: 0,
        pageId: 'page-1',
      },
    },
  });
});

test('adds repeatWarning after three consecutive identical calls', () => {
  const guard = new ToolCallContextGuard(() => null);

  guard.recordCall('hookCookie');
  guard.recordCall('hookCookie');
  guard.recordCall('hookCookie');

  const result = guard.enrichResponse('hookCookie', {
    structuredContent: {ok: true},
  });

  assert.equal(typeof result.structuredContent.repeatWarning, 'string');
});

test('does not mutate non-context-sensitive tools without repeat loops', () => {
  const guard = new ToolCallContextGuard(() => {
    throw new Error('provider should not be called');
  });

  guard.recordCall('deobfuscateCode');
  const response = {structuredContent: {ok: true}};

  assert.equal(guard.enrichResponse('deobfuscateCode', response), response);
});
```

- [ ] **Step 3: Run test and confirm failure**

Run:

```bash
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/worker/ToolCallContextGuard.test.js
```

Expected: FAIL because `ToolCallContextGuard` does not exist.

- [ ] **Step 4: Implement `ToolCallContextGuard`**

Create `src/worker/ToolCallContextGuard.ts`:

```ts
export interface ToolTabContext {
  url: string | null;
  title: string | null;
  tabIndex: number | null;
  pageId: string | null;
}

export interface ToolTabContextProvider {
  getContextMeta(): ToolTabContext;
}

const CONTEXT_SENSITIVE_PREFIXES = [
  'page',
  'navigation',
  'dom',
  'debugger',
  'network',
  'hook',
  'script',
  'console',
  'input',
  'frames',
  'screenshot',
] as const;

const MAX_CONSECUTIVE_REPEATS = 3;

export class ToolCallContextGuard {
  private readonly contextSensitiveCache = new Map<string, boolean>();
  private lastToolName: string | null = null;
  private consecutiveCount = 0;

  constructor(private readonly getProvider: () => ToolTabContextProvider | null) {}

  recordCall(toolName: string): number {
    if (toolName === this.lastToolName) {
      this.consecutiveCount++;
    } else {
      this.lastToolName = toolName;
      this.consecutiveCount = 1;
    }
    return this.consecutiveCount;
  }

  enrichResponse<T>(toolName: string, response: T): T {
    if (typeof response !== 'object' || response === null) return response;

    const target = response as Record<string, unknown>;
    const structured =
      typeof target.structuredContent === 'object' && target.structuredContent !== null
        ? (target.structuredContent as Record<string, unknown>)
        : target;

    if (this.consecutiveCount >= MAX_CONSECUTIVE_REPEATS) {
      structured.repeatWarning =
        `Tool "${toolName}" was called ${this.consecutiveCount} times consecutively. Check whether a different observation or navigation tool is needed.`;
    }

    if (!this.isContextSensitive(toolName)) return response;

    const provider = this.getProvider();
    if (!provider) return response;

    const meta = provider.getContextMeta();
    if (!meta.pageId && meta.tabIndex === null) return response;

    if (!('_tabContext' in structured)) {
      structured._tabContext = meta;
    }

    return response;
  }

  private isContextSensitive(toolName: string): boolean {
    const cached = this.contextSensitiveCache.get(toolName);
    if (cached !== undefined) return cached;

    const lower = toolName.toLowerCase();
    const result = CONTEXT_SENSITIVE_PREFIXES.some(prefix => lower.startsWith(prefix));
    this.contextSensitiveCache.set(toolName, result);
    return result;
  }
}
```

- [ ] **Step 5: Expose context meta from `ToolContextProvider`**

Add:

```ts
getContextMeta(): {
  url: string | null;
  title: string | null;
  tabIndex: number | null;
  pageId: string | null;
} {
  const page = this.getSelectedPage();
  const pages = this.getPages();
  return {
    url: page?.url() ?? null,
    title: null,
    tabIndex: page ? pages.indexOf(page) : null,
    pageId: page ? String(pages.indexOf(page)) : null,
  };
}
```

If `page.title()` is async in the current browser library, keep `title: null` in this first pass and do not make the guard async.

- [ ] **Step 6: Wire guard into `ToolExecutionPipeline`**

Add a constructor dependency:

```ts
private readonly contextGuard?: ToolCallContextGuard,
```

In `execute()` after `normalizeResponse()` and before offload:

```ts
const normalized = this.normalizeResponse(rawResult);
this.contextGuard?.recordCall(toolName);
const enriched = this.contextGuard?.enrichResponse(toolName, normalized) ?? normalized;
const response = this.offloader.handle(enriched);
```

- [ ] **Step 7: Verify**

Run:

```bash
npm run typecheck
npm run test:worker
```

Expected: PASS.

---

### Task 3: Upgrade Tool Search Ranking

**Files:**
- Create: `src/cli/tool-search-engine.ts`
- Modify: `src/cli/tools-meta.ts`
- Test: `tests/unit/cli/tool-search-engine.test.ts`

- [ ] **Step 1: Run impact analysis**

Run:

```bash
npx gitnexus impact searchTools --direction upstream
npx gitnexus impact getToolsMeta --direction upstream
```

Expected: direct callers include CLI list/search paths and tool dispatch tests.

- [ ] **Step 2: Write search ranking tests**

Create `tests/unit/cli/tool-search-engine.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {ToolSearchEngine} from '../../../src/cli/tool-search-engine.js';
import type {ToolMeta} from '../../../src/cli/tools-meta.js';

const tools: ToolMeta[] = [
  {
    name: 'hookCookie',
    description: 'Hook document.cookie getter and setter',
    schema: {},
    argSpecs: {},
    modulePath: './hook/Cookie.js',
    handlerName: 'hookCookie',
    callMode: 'defineTool',
    domain: 'hook',
    profile: 'workflow',
    sceneKeywords: ['cookie', 'runtime', 'hook'],
  },
  {
    name: 'listConsoleMessages',
    description: 'List browser console messages',
    schema: {},
    argSpecs: {},
    modulePath: './console/listConsoleMessages.js',
    handlerName: 'listConsoleMessages',
    callMode: 'defineTool',
    domain: 'console',
    profile: 'workflow',
  },
];

test('ranks scene keyword and domain matches above generic description matches', () => {
  const results = new ToolSearchEngine(tools).search('cookie hook');
  assert.equal(results[0]?.name, 'hookCookie');
});

test('uses argument names as searchable tokens', () => {
  const engine = new ToolSearchEngine([
    {
      ...tools[0],
      name: 'traceSignatureGeneration',
      description: 'Trace signature generation flow',
      argSpecs: {
        urlPattern: {
          type: 'string',
          required: false,
          description: 'URL pattern to filter target requests',
        },
      },
      domain: 'workflow',
      sceneKeywords: ['signature', 'trace'],
    },
  ]);

  assert.equal(engine.search('url pattern signature')[0]?.name, 'traceSignatureGeneration');
});
```

- [ ] **Step 3: Run test and confirm failure**

Run:

```bash
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/cli/tool-search-engine.test.js
```

Expected: FAIL because search engine file does not exist.

- [ ] **Step 4: Implement `ToolSearchEngine`**

Create `src/cli/tool-search-engine.ts`:

```ts
import type {ToolMeta} from './tools-meta.js';

export interface ToolSearchOptions {
  limit?: number;
}

interface SearchDoc {
  tool: ToolMeta;
  weightedTokens: Map<string, number>;
}

export class ToolSearchEngine {
  private readonly docs: SearchDoc[];

  constructor(tools: readonly ToolMeta[]) {
    this.docs = tools.map(tool => ({
      tool,
      weightedTokens: this.buildTokens(tool),
    }));
  }

  search(query: string, options: ToolSearchOptions = {}): ToolMeta[] {
    const queryTokens = this.tokenize(query);
    const scored = this.docs
      .map(doc => ({tool: doc.tool, score: this.score(doc, queryTokens)}))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));

    return scored.slice(0, options.limit ?? 20).map(item => item.tool);
  }

  private score(doc: SearchDoc, queryTokens: string[]): number {
    let score = 0;
    for (const token of queryTokens) {
      score += doc.weightedTokens.get(token) ?? 0;
      for (const [candidate, weight] of doc.weightedTokens) {
        if (candidate.includes(token) || token.includes(candidate)) {
          score += weight * 0.25;
        }
      }
    }
    return score;
  }

  private buildTokens(tool: ToolMeta): Map<string, number> {
    const tokens = new Map<string, number>();
    const add = (value: string | undefined, weight: number) => {
      for (const token of this.tokenize(value ?? '')) {
        tokens.set(token, Math.max(tokens.get(token) ?? 0, weight));
      }
    };

    add(tool.name, 3);
    add(tool.domain, 2);
    add(tool.description, 1);
    for (const keyword of tool.sceneKeywords ?? []) add(keyword, 2);
    for (const [name, spec] of Object.entries(tool.argSpecs)) {
      add(name, 1.5);
      add(spec.description, 1);
    }
    return tokens;
  }

  private tokenize(value: string): string[] {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/u)
      .filter(Boolean);
  }
}
```

- [ ] **Step 5: Delegate `searchTools()`**

In `src/cli/tools-meta.ts`, import `ToolSearchEngine` and replace the body:

```ts
export async function searchTools(query: string): Promise<ToolMeta[]> {
  const meta = await getToolsMeta();
  return new ToolSearchEngine(meta).search(query);
}
```

- [ ] **Step 6: Add scene keywords to priority manifests**

Start with `src/tools/hook/manifest.ts` and `src/tools/workflow/manifest.ts`:

```ts
sceneKeywords: {
  hookCookie: ['cookie', 'document.cookie', 'runtime hook'],
  hookFetch: ['fetch', 'request', 'network hook'],
  injectHook: ['inject', 'runtime', 'instrumentation'],
}
```

```ts
sceneKeywords: {
  observeFlow: ['observe', 'network', 'console', 'flow'],
  autoHook: ['automatic hook', 'signature', 'runtime'],
  traceSignatureGeneration: ['signature', 'trace', 'request signing'],
}
```

- [ ] **Step 7: Verify**

Run:

```bash
npm run typecheck
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/cli/tool-search-engine.test.js
```

Expected: PASS.

---

### Task 4: Add Declarative Workflow Contracts

**Files:**
- Create: `src/tools/workflow/contracts.ts`
- Create: `src/tools/workflow/builtin-contracts.ts`
- Modify: `src/tools/workflow/manifest.ts`
- Test: `tests/unit/tools/workflow/contracts.test.ts`

- [ ] **Step 1: Run impact analysis**

Run:

```bash
npx gitnexus impact observeFlow --direction upstream
npx gitnexus impact autoHook --direction upstream
npx gitnexus impact traceSignatureGeneration --direction upstream
```

Expected: direct callers include workflow tests and generated tool registry consumers.

- [ ] **Step 2: Write contract tests**

Create `tests/unit/tools/workflow/contracts.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {builtinWorkflowContracts} from '../../../../src/tools/workflow/builtin-contracts.js';

test('builtin workflow contracts expose stable ids and route metadata', () => {
  const ids = builtinWorkflowContracts.map(contract => contract.id);
  assert.deepEqual(ids.sort(), ['auto-hook', 'observe-flow', 'rebuild-bundle', 'trace-signature-generation']);

  for (const contract of builtinWorkflowContracts) {
    assert.equal(contract.kind, 'workflow-contract');
    assert.equal(contract.version, 1);
    assert.ok(contract.route.patterns.length > 0);
    assert.ok(contract.steps.length > 0);
  }
});

test('auto-hook contract declares observe before inject dependency', () => {
  const contract = builtinWorkflowContracts.find(item => item.id === 'auto-hook');
  assert.ok(contract);
  assert.deepEqual(
    contract.steps.map(step => step.toolName),
    ['observeFlow', 'createHook', 'injectHook'],
  );
});
```

- [ ] **Step 3: Implement `contracts.ts`**

Create:

```ts
export interface WorkflowStepContract {
  id: string;
  toolName: string;
  description: string;
  prerequisites: string[];
  expectedInputs?: Record<string, string>;
  parallel?: boolean;
}

export interface WorkflowRouteContract {
  patterns: RegExp[];
  priority: number;
  requiredDomains: string[];
  hint: string;
}

export interface WorkflowContract {
  kind: 'workflow-contract';
  version: 1;
  id: string;
  displayName: string;
  description: string;
  route: WorkflowRouteContract;
  steps: WorkflowStepContract[];
}
```

- [ ] **Step 4: Implement `builtin-contracts.ts`**

Create:

```ts
import type {WorkflowContract} from './contracts.js';

export const builtinWorkflowContracts: WorkflowContract[] = [
  {
    kind: 'workflow-contract',
    version: 1,
    id: 'observe-flow',
    displayName: 'Observe Flow',
    description: 'Collect page, console, network and script evidence before choosing hooks.',
    route: {
      patterns: [/observe/i, /分析.*流程/u, /抓.*流程/u],
      priority: 80,
      requiredDomains: ['workflow', 'network', 'console', 'collector'],
      hint: 'Start with observeFlow before injecting hooks.',
    },
    steps: [
      {
        id: 'observe',
        toolName: 'observeFlow',
        description: 'Collect baseline runtime evidence.',
        prerequisites: ['requiresPage'],
      },
    ],
  },
  {
    kind: 'workflow-contract',
    version: 1,
    id: 'auto-hook',
    displayName: 'Auto Hook',
    description: 'Observe candidate behavior, generate hook code, then inject it.',
    route: {
      patterns: [/auto.*hook/i, /自动.*hook/u, /自动.*注入/u],
      priority: 90,
      requiredDomains: ['workflow', 'hook'],
      hint: 'Observe first, create hook second, inject last.',
    },
    steps: [
      {id: 'observe', toolName: 'observeFlow', description: 'Find hook targets.', prerequisites: ['requiresPage']},
      {id: 'create', toolName: 'createHook', description: 'Create hook script.', prerequisites: []},
      {id: 'inject', toolName: 'injectHook', description: 'Inject hook script.', prerequisites: ['requiresPage']},
    ],
  },
  {
    kind: 'workflow-contract',
    version: 1,
    id: 'rebuild-bundle',
    displayName: 'Rebuild Bundle',
    description: 'Rebuild collected JavaScript bundle artifacts for offline analysis.',
    route: {
      patterns: [/rebuild/i, /重建.*bundle/u],
      priority: 70,
      requiredDomains: ['workflow', 'rebuild'],
      hint: 'Collect code before rebuilding bundle artifacts.',
    },
    steps: [
      {id: 'rebuild', toolName: 'rebuildBundle', description: 'Rebuild bundle from collected artifacts.', prerequisites: []},
    ],
  },
  {
    kind: 'workflow-contract',
    version: 1,
    id: 'trace-signature-generation',
    displayName: 'Trace Signature Generation',
    description: 'Trace request signing and signature generation flow.',
    route: {
      patterns: [/signature/i, /签名/u, /追.*签/u],
      priority: 95,
      requiredDomains: ['workflow', 'debugger', 'hook', 'network'],
      hint: 'Capture request evidence, then trace signature generation.',
    },
    steps: [
      {id: 'trace', toolName: 'traceSignatureGeneration', description: 'Trace signing flow.', prerequisites: ['requiresPage']},
    ],
  },
];
```

- [ ] **Step 5: Reference contracts from workflow manifest**

In `src/tools/workflow/manifest.ts`, add:

```ts
workflowRule: {
  patterns: [/observe/i, /auto.*hook/i, /signature/i, /签名/u],
  priority: 90,
  tools: ['observeFlow', 'autoHook', 'traceSignatureGeneration'],
  hint: 'Use workflow contracts to select observe, hook, rebuild, or signature tracing flows.',
},
```

- [ ] **Step 6: Verify**

Run:

```bash
npm run typecheck
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/workflow/contracts.test.js
```

Expected: PASS.

---

### Task 5: Add Prerequisite Checking Before Tool Execution

**Files:**
- Create: `src/tools/prerequisites/ToolPrerequisiteChecker.ts`
- Modify: `src/worker/ToolExecutionPipeline.ts`
- Modify: `src/tools/debugger/manifest.ts`
- Modify: `src/tools/hook/manifest.ts`
- Test: `tests/unit/tools/prerequisites/ToolPrerequisiteChecker.test.ts`
- Test: `tests/unit/worker/ToolExecutionPipeline.test.ts`

- [ ] **Step 1: Run impact analysis**

Run:

```bash
npx gitnexus impact ToolExecutionPipeline --direction upstream
npx gitnexus impact createToolError --direction upstream
```

Expected: direct callers include worker execution tests and CLI/worker dispatch.

- [ ] **Step 2: Write prerequisite checker tests**

Create `tests/unit/tools/prerequisites/ToolPrerequisiteChecker.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {ToolPrerequisiteChecker} from '../../../../src/tools/prerequisites/ToolPrerequisiteChecker.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';

test('throws PREREQUISITE when a page is required but unavailable', () => {
  const checker = new ToolPrerequisiteChecker({
    getSelectedPage: () => null,
    getDebuggerContext: async () => {
      throw new Error('not expected');
    },
  });

  assert.throws(
    () =>
      checker.check('injectHook', [
        {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
      ]),
    (error: unknown) =>
      error instanceof ToolError &&
      error.code === ErrorCodes.PREREQUISITE &&
      error.context?.fix === 'Start or attach a browser page first.',
  );
});

test('passes when a required page exists', () => {
  const checker = new ToolPrerequisiteChecker({
    getSelectedPage: () => ({url: () => 'https://example.test'}),
    getDebuggerContext: async () => ({}),
  });

  checker.check('injectHook', [
    {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
  ]);
});
```

- [ ] **Step 3: Implement checker**

Create:

```ts
import type {ToolPrerequisite} from '../manifest.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';

interface PrerequisiteContext {
  getSelectedPage(): unknown;
  getDebuggerContext?(): Promise<unknown>;
}

export class ToolPrerequisiteChecker {
  constructor(private readonly context: PrerequisiteContext) {}

  check(toolName: string, prerequisites: readonly ToolPrerequisite[] | undefined): void {
    for (const prerequisite of prerequisites ?? []) {
      if (prerequisite.condition === 'requiresPage' && !this.context.getSelectedPage()) {
        throw createToolError(
          ErrorCodes.PREREQUISITE,
          `Tool "${toolName}" requires an active page.`,
          {toolName, condition: prerequisite.condition, fix: prerequisite.fix},
        );
      }
    }
  }
}
```

- [ ] **Step 4: Wire checker into pipeline**

Add optional constructor dependency:

```ts
private readonly prerequisiteChecker?: ToolPrerequisiteChecker,
```

Before handler load:

```ts
this.prerequisiteChecker?.check(toolName, meta.prerequisites);
```

- [ ] **Step 5: Add manifest prerequisites**

In `src/tools/hook/manifest.ts`, add:

```ts
prerequisites: {
  injectHook: [{condition: 'requiresPage', fix: 'Start or attach a browser page before injecting hooks.'}],
  listPersistentHooks: [{condition: 'requiresPage', fix: 'Start or attach a browser page before listing injected hooks.'}],
}
```

In `src/tools/debugger/manifest.ts`, add page prerequisites for breakpoint and stepping tools.

- [ ] **Step 6: Verify**

Run:

```bash
npm run typecheck
npm run test:worker
npm run test:unit
```

Expected: PASS.

---

## Execution Order

1. Task 1: manifest metadata contract
2. Task 2: execution context guard
3. Task 3: search ranking
4. Task 4: workflow contracts
5. Task 5: prerequisite checker

Task 2 and Task 3 can run in parallel after Task 1 is complete. Task 5 depends on Task 1 and should run after the metadata shape is stable.

## Verification Matrix

| Phase | Required commands |
| --- | --- |
| Manifest contract | `npm run typecheck`, `npm run build`, focused ToolRegistry test |
| Context guard | `npm run typecheck`, `npm run test:worker` |
| Search ranking | `npm run typecheck`, focused CLI search test |
| Workflow contracts | `npm run typecheck`, focused workflow contract test |
| Prerequisite checker | `npm run typecheck`, `npm run test:worker`, `npm run test:unit` |
| Final integration | `npm run check-format`, `npm run typecheck`, `npm run build`, `npm run test:unit` |

## Risks

- `ToolMeta` shape expansion may require test fixture updates under `src/tools/test-fixtures/` and `tests/unit/tools/`.
- Guard response enrichment must not change existing `content` arrays unexpectedly; prefer structuredContent mutation only where present.
- Search ranking can change CLI result order. Tests should assert high-value ordering only for explicit query fixtures, not every existing list command.
- Workflow contracts are documentation/routing metadata in this plan; they should not replace existing workflow handler behavior until separate execution-engine work is planned.
- Prerequisite checks must start with narrow conditions. Do not add broad checks that block read-only tools such as listing cached data or offline deobfuscation.

## Completion Criteria

- Existing tool names, schemas, aliases, and base response formats remain compatible.
- Priority manifests expose scene keywords and prerequisites for hook, workflow, debugger, and network domains.
- Context-sensitive tool responses include `_tabContext` when an active page exists.
- Repeated identical tool calls produce a warning after the third consecutive call.
- `searchTools()` ranks domain, parameter, and scene keyword matches above plain substring matches.
- Workflow contract tests prove built-in workflow metadata is available without executing browser actions.
- All verification commands in the final integration row pass.
