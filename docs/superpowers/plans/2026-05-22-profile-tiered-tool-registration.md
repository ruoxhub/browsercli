# Profile 分层工具注册改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 借鉴 jshookmcp 的 Profile 分层注册机制，给 24 个 domain manifest 标注 `profile` 字段，并新增 `meta` domain 暴露 `search_tools` 元工具，让 LLM 在 search 档（~500 tokens）下也能可用，可按需切到 workflow（~80 工具）或 full（全量）。

**Architecture:** 当前 `src/tools/manifest.ts` 已定义 `ToolProfile = 'search' | 'workflow' | 'full'`，`src/tools/registry/ToolRegistry.ts` 已实现按层级过滤（PROFILE_ORDER `search=0 < workflow=1 < full=2`），`src/cli/tools-meta.ts:72` 已读 `JS_REVERSE_TOOL_PROFILE` 环境变量。三处骨架完整，但 24 个 manifest 都没标 `profile`，且没有元工具暴露 `searchTools()` 给 LLM。本计划只填这两处空缺，不动执行链路。

**Tech Stack:** TypeScript 5.9 (strict), Node.js 22+, swc 编译，vitest + node:test，zod schema，自动生成 `src/tools/generated-tools-index.ts`（来自 `scripts/generate-tools-index.ts`）。

---

## File Structure

### Files Modified
- `src/tools/<domain>/manifest.ts` (24 个) — 添加 `profile` 字段（域级或工具级）
- `src/cli/tools-meta.ts` — 修复 `JS_REVERSE_TOOL_PROFILE` 默认值文档

### Files Created
- `src/tools/meta/manifest.ts` — 新 domain manifest，挂载元工具，`profile: 'search'`
- `src/tools/meta/searchTools.ts` — 包装 `searchTools()` 为 `defineTool` 元工具
- `tests/unit/tools/meta/searchTools.test.ts` — 元工具行为单元测试
- `tests/unit/tools/profile-coverage.test.ts` — 守卫所有 manifest 标注 profile 的回归测试

### Files Auto-Regenerated
- `src/tools/generated-tools-index.ts` — `npm run build:index` 重新生成，包含 meta domain

---

## Profile 分档决策

| Profile | Domain | 工具数 | 设计意图 |
|---------|--------|--------|---------|
| **search** | `meta` | 1 | LLM 入口，约 500 tokens，仅 `search_tools` |
| **workflow** | `analyzer`, `code-templates`, `collector`, `console`, `dialog`, `dom`, `frames`, `hook`, `input`, `navigation`, `network`, `page`, `screenshot`, `script`, `site-experience`, `workflow` | ~110 | 浏览器交互 + 逆向骨干 |
| **full** | `anti-debug`, `debugger`, `emulation`, `extensions`, `performance`, `pipeline`, `rebuild`, `stealth`, `wasm` | 剩余 | 重型逆向 / 调试 / 仿真 |

注：单工具可通过 `profile: 'workflow'` 字段从 full domain 下放到 workflow（如 `analyzer` 整体走 workflow，但 `pipeline.deepAnalysis` 留在 full）。本计划中先按"域级"统一标注，需要时后续微调。

---

## Task 1: Profile 守卫测试（先红后绿）

**Files:**
- Test: `tests/unit/tools/profile-coverage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {GENERATED_DOMAIN_MANIFESTS} from '../../../src/tools/generated-tools-index.js';

describe('Profile coverage', () => {
  it('every domain manifest declares an explicit profile', () => {
    const missing = GENERATED_DOMAIN_MANIFESTS.filter(m => !m.profile).map(
      m => m.name,
    );

    assert.deepStrictEqual(
      missing,
      [],
      `Domains without profile: ${missing.join(', ')}`,
    );
  });

  it('search profile yields at least one tool (meta domain present)', () => {
    const searchTools = GENERATED_DOMAIN_MANIFESTS.flatMap(manifest =>
      manifest.tools.filter(
        tool => (tool.profile ?? manifest.profile) === 'search',
      ),
    );

    assert.ok(
      searchTools.length >= 1,
      'search profile must include at least one tool (meta.search_tools)',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/profile-coverage.test.js`
Expected: FAIL — "Domains without profile: analyzer, anti-debug, code-templates, ..." (24 个 domain 都缺 profile)

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/tools/profile-coverage.test.ts
git commit -m "test: add profile coverage guard for domain manifests"
```

---

## Task 2: 标注 workflow 档 manifest（16 个域）

**Files:**
- Modify: `src/tools/analyzer/manifest.ts`
- Modify: `src/tools/code-templates/manifest.ts`
- Modify: `src/tools/collector/manifest.ts`
- Modify: `src/tools/console/manifest.ts`
- Modify: `src/tools/dialog/manifest.ts`
- Modify: `src/tools/dom/manifest.ts`
- Modify: `src/tools/frames/manifest.ts`
- Modify: `src/tools/hook/manifest.ts`
- Modify: `src/tools/input/manifest.ts`
- Modify: `src/tools/navigation/manifest.ts`
- Modify: `src/tools/network/manifest.ts`
- Modify: `src/tools/page/manifest.ts`
- Modify: `src/tools/screenshot/manifest.ts`
- Modify: `src/tools/script/manifest.ts`
- Modify: `src/tools/site-experience/manifest.ts`
- Modify: `src/tools/workflow/manifest.ts`

- [ ] **Step 1: Add `profile: 'workflow'` to analyzer manifest**

Read `src/tools/analyzer/manifest.ts` first, then edit. Insert `profile` line right after `description`:

```typescript
export const manifest = {
  name: 'analyzer',
  description: 'Static and AI-assisted JavaScript analysis tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './analyzer/deobfuscate.js', handlerName: 'deobfuscateCode'},
    // ... rest unchanged
  ],
} satisfies DomainManifest;
```

- [ ] **Step 2: Repeat for the remaining 15 workflow domains**

Pattern (apply to each manifest in the list above): insert `profile: 'workflow',` immediately after the `description` field, preserving everything else verbatim.

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 4: Regenerate domain index**

Run: `npm run build:index`
Expected: `Generated 24 manifests with N tools` printed; `src/tools/generated-tools-index.ts` updated.

- [ ] **Step 5: Sanity-check the regenerated index**

Read `src/tools/generated-tools-index.ts` and confirm `analyzerManifest` now exports `profile: 'workflow'` (the generator copies it through, see `scripts/generate-tools-index.ts:127`).

- [ ] **Step 6: Commit**

```bash
git add src/tools/analyzer/manifest.ts src/tools/code-templates/manifest.ts src/tools/collector/manifest.ts src/tools/console/manifest.ts src/tools/dialog/manifest.ts src/tools/dom/manifest.ts src/tools/frames/manifest.ts src/tools/hook/manifest.ts src/tools/input/manifest.ts src/tools/navigation/manifest.ts src/tools/network/manifest.ts src/tools/page/manifest.ts src/tools/screenshot/manifest.ts src/tools/script/manifest.ts src/tools/site-experience/manifest.ts src/tools/workflow/manifest.ts src/tools/generated-tools-index.ts
git commit -m "feat(tools): tag 16 domain manifests with workflow profile"
```

---

## Task 3: 标注 full 档 manifest（9 个域）

**Files:**
- Modify: `src/tools/anti-debug/manifest.ts`
- Modify: `src/tools/debugger/manifest.ts`
- Modify: `src/tools/emulation/manifest.ts`
- Modify: `src/tools/extensions/manifest.ts`
- Modify: `src/tools/performance/manifest.ts`
- Modify: `src/tools/pipeline/manifest.ts`
- Modify: `src/tools/rebuild/manifest.ts`
- Modify: `src/tools/stealth/manifest.ts`
- Modify: `src/tools/wasm/manifest.ts`

- [ ] **Step 1: Add `profile: 'full'` to debugger manifest**

Read `src/tools/debugger/manifest.ts`, then insert profile field:

```typescript
export const manifest = {
  name: 'debugger',
  description: 'Debugger protocol inspection and breakpoint tools.',
  profile: 'full',
  prerequisites: {
    setBreakpoint: [
      // ... unchanged
    ],
    // ...
  },
  tools: [
    // ... unchanged
  ],
} satisfies DomainManifest;
```

- [ ] **Step 2: Repeat for remaining 8 full domains**

Same pattern: insert `profile: 'full',` after `description` for each manifest in the list above.

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Regenerate index**

Run: `npm run build:index`
Expected: `Generated 24 manifests with N tools`

- [ ] **Step 5: Run profile coverage test (still failing — meta domain missing)**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/profile-coverage.test.js`
Expected: FAIL on second case — `search profile must include at least one tool (meta.search_tools)`. The first case (every domain has profile) should now PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/anti-debug/manifest.ts src/tools/debugger/manifest.ts src/tools/emulation/manifest.ts src/tools/extensions/manifest.ts src/tools/performance/manifest.ts src/tools/pipeline/manifest.ts src/tools/rebuild/manifest.ts src/tools/stealth/manifest.ts src/tools/wasm/manifest.ts src/tools/generated-tools-index.ts
git commit -m "feat(tools): tag 9 domain manifests with full profile"
```

---

## Task 4: 元工具 search_tools — 失败测试

**Files:**
- Test: `tests/unit/tools/meta/searchTools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {searchToolsMeta} from '../../../../src/tools/meta/searchTools.js';

describe('searchToolsMeta', () => {
  it('exposes defineTool shape with correct name and category', () => {
    assert.strictEqual(searchToolsMeta.name, 'search_tools');
    assert.strictEqual(searchToolsMeta.annotations.readOnlyHint, true);
    assert.ok(
      typeof searchToolsMeta.description === 'string' &&
        searchToolsMeta.description.length > 0,
    );
  });

  it('schema declares query string and optional limit', () => {
    const keys = Object.keys(searchToolsMeta.schema);
    assert.ok(keys.includes('query'));
    assert.ok(keys.includes('limit'));
  });

  it('handler returns JSON list of matching tools through response', async () => {
    const lines: string[] = [];
    const fakeResponse = {
      appendResponseLine: (value: string) => lines.push(value),
      setStructuredContent: () => {},
      setIncludePages: () => {},
      setIncludeNetworkRequests: () => {},
      setIncludeConsoleData: () => {},
      attachImage: () => {},
      attachNetworkRequest: () => {},
      attachConsoleMessage: () => {},
      setIncludeWebSocketConnections: () => {},
      attachWebSocket: () => {},
    };

    await searchToolsMeta.handler(
      {params: {query: 'screenshot', limit: 3}},
      fakeResponse as never,
      {} as never,
    );

    const payload = lines.join('\n');
    const parsed = JSON.parse(payload) as Array<{name: string}>;
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length <= 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/meta/searchTools.test.js`
Expected: FAIL — module `src/tools/meta/searchTools.js` not found.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/tools/meta/searchTools.test.ts
git commit -m "test: add failing spec for search_tools meta tool"
```

---

## Task 5: 实现 search_tools 元工具

**Files:**
- Create: `src/tools/meta/searchTools.ts`
- Create: `src/tools/meta/manifest.ts`

- [ ] **Step 1: Create meta domain manifest**

Write `src/tools/meta/manifest.ts`:

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'meta',
  description: 'Meta tools for tool discovery (search_tools entry point).',
  profile: 'search',
  sceneKeywords: {
    searchTools: ['search', 'discover', 'find tool', 'tool catalog'],
  },
  tools: [
    {modulePath: './meta/searchTools.js', handlerName: 'searchToolsMeta'},
  ],
} satisfies DomainManifest;
```

- [ ] **Step 2: Implement search_tools handler**

Write `src/tools/meta/searchTools.ts`:

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {ensureToolsMeta, searchTools} from '../../cli/tools-meta.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

interface ToolSearchHit {
  name: string;
  description: string;
  domain: string;
  profile: string;
}

export const searchToolsMeta = defineTool({
  name: 'search_tools',
  description:
    'Find reverse-engineering tools by natural language query. Returns tool name, description, domain and profile. Use this when the active profile does not yet expose the tool you need; the result tells you which tool to ask the operator to enable.',
  annotations: {category: ToolCategory.DATA, readOnlyHint: true},
  schema: {
    query: zod
      .string()
      .min(1)
      .describe('Natural language description of what you want to do.'),
    limit: zod
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Max results (default 10).'),
  },
  handler: async (request, response) => {
    await ensureToolsMeta();
    const {query, limit = 10} = request.params;
    const results = await searchTools(query);
    const hits: ToolSearchHit[] = results.slice(0, limit).map(t => ({
      name: t.name,
      description: t.description,
      domain: t.domain,
      profile: t.profile,
    }));
    response.appendResponseLine(JSON.stringify(hits, null, 2));
  },
});
```

- [ ] **Step 3: Regenerate domain index so meta domain ships**

Run: `npm run build:index`
Expected: `Generated 25 manifests with N tools`. Confirm `metaManifest` import now appears in `src/tools/generated-tools-index.ts`.

- [ ] **Step 4: Build & run searchTools meta unit test**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/meta/searchTools.test.js`
Expected: PASS (3 cases)

- [ ] **Step 5: Run profile coverage guard**

Run: `node --require ./build/tests/setup.js --test build/tests/unit/tools/profile-coverage.test.js`
Expected: PASS (both cases now green)

- [ ] **Step 6: Commit**

```bash
git add src/tools/meta/manifest.ts src/tools/meta/searchTools.ts src/tools/generated-tools-index.ts
git commit -m "feat(tools): add meta domain with search_tools entry point"
```

---

## Task 6: 端到端验证 — 三档过滤

**Files:**
- Test: `tests/unit/tools/profile-coverage.test.ts` (extend)

- [ ] **Step 1: Add cross-domain profile filtering test**

Append to `tests/unit/tools/profile-coverage.test.ts` inside the existing `describe`:

```typescript
  it('search profile yields exactly the meta domain tools', () => {
    const {ToolRegistry} = require('../../../src/tools/registry/ToolRegistry.js');
    const tools = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS).listTools(
      'search',
    );
    assert.ok(tools.length >= 1);
    assert.ok(tools.every((t: {domain: string}) => t.domain === 'meta'));
  });

  it('workflow profile excludes full-only domains like debugger and wasm', () => {
    const {ToolRegistry} = require('../../../src/tools/registry/ToolRegistry.js');
    const tools = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS).listTools(
      'workflow',
    );
    const domains = new Set(tools.map((t: {domain: string}) => t.domain));
    assert.ok(!domains.has('debugger'), 'debugger should be full-only');
    assert.ok(!domains.has('wasm'), 'wasm should be full-only');
    assert.ok(domains.has('meta'), 'meta should bubble up to workflow');
    assert.ok(domains.has('hook'), 'hook is workflow-tier');
  });

  it('full profile is the union of all domains', () => {
    const {ToolRegistry} = require('../../../src/tools/registry/ToolRegistry.js');
    const tools = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS).listTools(
      'full',
    );
    const domains = new Set(tools.map((t: {domain: string}) => t.domain));
    assert.strictEqual(domains.size, GENERATED_DOMAIN_MANIFESTS.length);
  });
```

- [ ] **Step 2: Build and run**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/profile-coverage.test.js`
Expected: PASS (5 cases total)

- [ ] **Step 3: Run full unit test suite (vitest browser project covers tools/)**

Run: `npm run test:vitest:browser`
Expected: PASS — no regressions in `tests/unit/tools/**`

- [ ] **Step 4: Sanity-check CLI list-tools with each profile**

Run:
```bash
JS_REVERSE_TOOL_PROFILE=search node build/src/bin/js-reverse.js list-tools --json | head -40
JS_REVERSE_TOOL_PROFILE=workflow node build/src/bin/js-reverse.js list-tools --json | head -40
JS_REVERSE_TOOL_PROFILE=full node build/src/bin/js-reverse.js list-tools --json | head -40
```
Expected:
- search → exactly 1 tool: `search_tools`
- workflow → ~110 tools, no `set_breakpoint`, no `wasm_*`
- full → all 200+ tools

Note: `list-tools` falls back to local meta when offline (`src/cli/commands/list-tools.ts:65-78`), so it does not require a running worker.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/tools/profile-coverage.test.ts
git commit -m "test: assert profile-tiered registration filters domains correctly"
```

---

## Task 7: 文档与默认值

**Files:**
- Modify: `src/cli/tools-meta.ts:72-78` (only the JSDoc above the function)
- Modify: `README.md` (add a Profile section)

- [ ] **Step 1: Update JSDoc on `getConfiguredToolProfile`**

Read `src/cli/tools-meta.ts` first. Replace the function with documented version:

```typescript
/**
 * Resolve the active tool profile from environment.
 *
 * | Profile     | Token cost (approx) | Purpose                                |
 * |-------------|---------------------|----------------------------------------|
 * | `search`    | ~500 tokens         | Only `search_tools`; LLM discovers     |
 * |             |                     | concrete tools on demand.              |
 * | `workflow`  | ~15K tokens         | Browser + reverse-engineering daily.   |
 * | `full`      | ~40K+ tokens        | Adds debugger, wasm, anti-debug, etc.  |
 *
 * Default: `full` to preserve current behaviour. Set
 * `JS_REVERSE_TOOL_PROFILE=workflow` (or `search`) to scope down.
 */
function getConfiguredToolProfile(): ToolProfile {
  const value = process.env.JS_REVERSE_TOOL_PROFILE;
  if (value === 'search' || value === 'workflow' || value === 'full') {
    return value;
  }
  return 'full';
}
```

- [ ] **Step 2: Add Profile section to README.md**

Read `README.md` and append (place it under an existing CLI / Configuration section if one exists; otherwise add a top-level `## Tool Profiles` section before the License footer):

```markdown
## Tool Profiles

`JSReverser-CLI` registers tools in tiers. Switch tier with the
`JS_REVERSE_TOOL_PROFILE` environment variable.

| Profile   | Tool count | When to use                                         |
| --------- | ---------- | --------------------------------------------------- |
| `search`  | 1          | LLM hosts with very tight context — exposes only    |
|           |            | `search_tools`; the LLM discovers tools on demand.  |
| `workflow`| ~110       | Browser automation + JS reverse engineering daily.  |
| `full`    | all        | Includes debugger, wasm, anti-debug, perf, rebuild. |

Default is `full` (no behaviour change). Example:

```bash
JS_REVERSE_TOOL_PROFILE=workflow npm run cli:start
```
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run full check**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/profile-coverage.test.js && node --require ./build/tests/setup.js --test build/tests/unit/tools/ToolRegistry.test.js && node --require ./build/tests/setup.js --test build/tests/unit/tools/ToolRegistry.profile.test.js`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/tools-meta.ts README.md
git commit -m "docs(tools): document profile tiers and default behaviour"
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ "给 24 个 manifest 标 profile" → Tasks 2 + 3 (16 workflow + 9 full = 25; +1 new meta = 25 total domains; the original 24 all tagged)
- ✅ "暴露 search_tools 元工具" → Tasks 4 + 5
- ✅ "search 档可用" → Task 6 step 4 验证

**Type consistency:** `searchToolsMeta` 名字一致；`ToolProfile` 类型来自 `src/tools/manifest.ts:19` 全程复用；`defineTool` schema 用 `zod`；`ToolCategory.DATA` 来自 `src/tools/categories.ts:18`，已存在。

**Placeholder scan:** 没有 TODO / TBD；每个 step 都给了具体代码或具体命令；没有"similar to Task N"。

**Risk / Reversibility:** 全部改动都在新增字段或新增文件层面，不改执行链路。`JS_REVERSE_TOOL_PROFILE` 默认 `full` 保留旧行为，回退只需 `git revert`。

**Out of scope (留给未来 plan):**
- 真·惰性加载（替换 `tools-meta.ts:154` 的 `Promise.all` 为 lazy import）
- CLI `--profile` flag（替代环境变量）
- 工具级 profile 微调（如 `analyzer.deepAnalyze` 下放 full）
- jshookmcp 的 EventBus / Domain Proxy / 大响应卸载（已在 `2026-05-20-jshookmcp-architecture-optimization-roadmap.md` 列出）
