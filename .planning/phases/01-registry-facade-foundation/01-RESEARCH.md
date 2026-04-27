# Phase 1: Registry Facade Foundation - Research

**Researched:** 2026-04-27 [VERIFIED: current_date]
**Domain:** TypeScript ESM tool registry compatibility facade [VERIFIED: .planning/ROADMAP.md + source inspection]
**Confidence:** HIGH [VERIFIED: source inspection + package.json + GitNexus impact + Context7/official docs]

<user_constraints>

## User Constraints

### Locked Decisions

- Phase 1 goal is to introduce a domain manifest contract and compatibility facade without changing current tool behavior. [VERIFIED: .planning/ROADMAP.md]
- Requirements in scope are REG-01, REG-02, REG-03, REG-04, and SAFE-01. [VERIFIED: .planning/ROADMAP.md + .planning/REQUIREMENTS.md]
- Add a type-level manifest contract for tool domains. [VERIFIED: user prompt + .planning/ROADMAP.md]
- Add a registry facade that can expose existing `tools-meta.ts` entries through the old API. [VERIFIED: user prompt + .planning/ROADMAP.md]
- Add duplicate-name detection and metadata validation. [VERIFIED: user prompt + .planning/ROADMAP.md]
- Add tests proving current tool count, names, and key metadata are unchanged. [VERIFIED: user prompt + .planning/ROADMAP.md]
- Existing CLI `list-tools` and worker registration must still use the same public metadata functions. [VERIFIED: user prompt + .planning/ROADMAP.md]
- Tests must fail if tool names disappear, duplicate, or change handler mapping unexpectedly. [VERIFIED: user prompt + .planning/ROADMAP.md]
- No tool handler behavior changes in this phase. [VERIFIED: user prompt + .planning/ROADMAP.md]
- Do not copy `jshookmcp` source code because `jshookmcp` is AGPL while this repository is Apache-2.0. [VERIFIED: user prompt + .planning/PROJECT.md + .planning/research/SUMMARY.md]
- Do not add new dependencies. [VERIFIED: user prompt + .planning/PROJECT.md + .planning/REQUIREMENTS.md]
- Before future implementation edits, executors must run GitNexus impact analysis on edited symbols. [VERIFIED: user prompt + AGENTS.md + CLAUDE.md]

### Claude's Discretion

- Choose the internal file layout for the facade and manifest type as long as `getAllToolNames`, `getToolMeta`, `searchTools`, `TOOLS_META`, and `ToolMeta` remain backward compatible. [VERIFIED: source inspection + GitNexus context]
- Choose whether metadata validation runs eagerly at module load or behind an exported helper, but duplicate-name detection must be deterministic and tested. [VERIFIED: .planning/ROADMAP.md + tests/unit/cli/tools-meta.test.ts]

### Deferred Ideas (OUT OF SCOPE)

- Do not migrate low-risk domains in Phase 1; that is Phase 2. [VERIFIED: .planning/ROADMAP.md]
- Do not add runtime dependency ensure helpers in Phase 1; that is Phase 3. [VERIFIED: .planning/ROADMAP.md]
- Do not add structured execution diagnostics in Phase 1; that is Phase 4. [VERIFIED: .planning/ROADMAP.md]
- Do not migrate debugger, network, page, or hook-heavy domains in Phase 1. [VERIFIED: .planning/ROADMAP.md]
- Do not replace Sekiro Worker architecture. [VERIFIED: .planning/PROJECT.md]

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REG-01 | Domain manifest type can describe tool metadata, domain name, call mode, handler binding, dependency needs, prerequisites, and workflow hints. [VERIFIED: .planning/REQUIREMENTS.md] | Use TypeScript interfaces extending current `ToolMeta` concepts, and use `satisfies` for literal manifest checking without widening metadata literals. [CITED: TypeScript 4.9 official blog] |
| REG-02 | Existing `getAllToolNames`, `getToolMeta`, and search/list behavior remain backward compatible. [VERIFIED: .planning/REQUIREMENTS.md] | Keep these exports in `src/cli/tools-meta.ts`; delegate internals to a facade while preserving return shapes and ordering. [VERIFIED: source inspection + GitNexus impact] |
| REG-03 | Registry can load metadata by domain without requiring all handler modules to be imported. [VERIFIED: .planning/REQUIREMENTS.md] | Store handler binding as strings (`modulePath`, `handlerName`) and avoid importing `src/tools/*` from registry files. [VERIFIED: src/cli/tools-meta.ts + src/worker/ToolAdapter.ts] |
| REG-04 | Duplicate tool names are detected deterministically and reported with enough context to fix. [VERIFIED: .planning/REQUIREMENTS.md] | Add validation that reports duplicate name plus domain/source/modulePath/handlerName; test duplicate fixtures independently of production metadata. [VERIFIED: tests/unit/cli/tools-meta.test.ts + tests/property/ToolRegistry.property.test.ts] |
| SAFE-01 | Every implementation phase runs GitNexus impact analysis before editing target symbols. [VERIFIED: .planning/REQUIREMENTS.md + AGENTS.md] | Planner must make GitNexus impact a pre-edit task for any change to `tools-meta.ts`, new registry symbols, or `ToolAdapter`. [VERIFIED: GitNexus impact] |

</phase_requirements>

## Summary

Phase 1 should be implemented as an internal compatibility facade behind the existing `src/cli/tools-meta.ts` exports. [VERIFIED: .planning/ROADMAP.md + source inspection] The current public surface is small but high leverage: `getAllToolNames` is consumed by worker registration, CLI offline list-tools, REPL completion, and `src/index.ts` built-in listing. [VERIFIED: GitNexus context for getAllToolNames] GitNexus rates upstream impact for changing `getAllToolNames` as HIGH with 6 direct callers and 2 affected processes, so the planner should treat ordering and return shape as compatibility-critical. [VERIFIED: GitNexus impact]

The current registry has 145 tools: 12 `params-only`, 74 `runtime`, and 59 `frame`; first tool is `observe_flow`, last tool is `fill`. [VERIFIED: `node --experimental-strip-types` source probe] Existing tests cover uniqueness and some known metadata but only assert `TOOLS_META.length >= 80`, so they are insufficient for Phase 1 compatibility. [VERIFIED: tests/unit/cli/tools-meta.test.ts] The main test addition should be an exact metadata snapshot or generated baseline asserting count, ordered names, and `name -> modulePath:handlerName:callMode` mapping. [VERIFIED: source inspection]

**Primary recommendation:** Add a new `src/cli/tool-registry/` facade and manifest type, adapt current `TOOLS_META` into a single legacy domain manifest, keep all existing exports from `src/cli/tools-meta.ts`, and add exact compatibility tests before any domain migration. [VERIFIED: .planning/ROADMAP.md + source inspection + GitNexus impact]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Manifest type contract | CLI/shared TypeScript layer | Worker | Metadata is imported by CLI commands and worker registration, but it must not import handlers. [VERIFIED: src/cli/tools-meta.ts + src/worker/ToolAdapter.ts] |
| Registry facade | CLI metadata layer | Worker | Existing public metadata functions live under `src/cli/tools-meta.ts` and are imported by worker and CLI code. [VERIFIED: source inspection + GitNexus context] |
| Duplicate-name detection | Registry facade | Tests | Duplicate checks belong where metadata is assembled, with tests proving deterministic errors. [VERIFIED: .planning/REQUIREMENTS.md + tests/unit/cli/tools-meta.test.ts] |
| Metadata compatibility tests | Test layer | CLI/Worker | Behavior lock should assert public metadata output and registration mapping without launching browser handlers. [VERIFIED: tests/README.md + tests/unit/worker/ToolAdapter.test.ts] |
| Handler execution | Worker | Tools | Phase 1 must not change handler invocation semantics; `ToolAdapter.wrapTool` currently dispatches by `callMode`. [VERIFIED: src/worker/ToolAdapter.ts] |

## Project Constraints (from CLAUDE.md / AGENTS.md)

- Repository is indexed by GitNexus as `JSReverser-MCP`; use GitNexus for code intelligence. [VERIFIED: CLAUDE.md + AGENTS.md]
- Run GitNexus impact analysis before modifying any function, class, or method. [VERIFIED: CLAUDE.md + AGENTS.md]
- Run GitNexus detect changes before committing. [VERIFIED: CLAUDE.md + AGENTS.md]
- Warn the user if impact analysis returns HIGH or CRITICAL. [VERIFIED: CLAUDE.md + AGENTS.md]
- Do not edit `build/` by hand. [VERIFIED: AGENTS.md]
- Use TypeScript ESM style. [VERIFIED: package.json + AGENTS.md]
- Prettier requires `singleQuote: true`, `trailingComma: all`, `arrowParens: avoid`, `bracketSpacing: false`, and `endOfLine: lf`. [VERIFIED: .prettierrc.cjs]
- ESLint enforces explicit type imports/exports, interface preference, import ordering, no import cycles, and `node:` protocol for built-ins. [VERIFIED: eslint.config.mjs]
- Tests use Node built-in `node:test`; new unit tests belong under `tests/unit/` and should mirror source structure. [VERIFIED: tests/README.md + package.json]
- Do not commit real cookies, storage, production parameters, or private `artifacts/tasks/` content. [VERIFIED: AGENTS.md]
- Preserve reverse-engineering methodology: observe first, prefer hooks, breakpoints last, evidence first. [VERIFIED: AGENTS.md + .planning/PROJECT.md]

## Standard Stack

### Core

| Library / Runtime | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| Node.js | local `v22.14.0`; package engine `^20.19.0 || ^22.12.0 || >=23` | Runtime and built-in test runner | Existing project runtime and scripts target Node; `node:test` supports `describe`/`it` ESM imports. [VERIFIED: `node --version` + package.json] [CITED: Context7 `/nodejs/node`] |
| TypeScript | package `^5.9.2`; local `5.9.3`; npm latest `6.0.3` as of 2026-04-16 | Type-level manifest contract | Existing compiler is TypeScript; `satisfies` validates object shape without losing literal inference. [VERIFIED: package.json + `npx tsc --version` + npm registry] [CITED: TypeScript 4.9 official blog] |
| SWC CLI / Core | `@swc/cli ^0.8.1`; `@swc/core` resolved latest `1.15.30` as of 2026-04-27 | Build TS to `build/` | Existing `npm run build` uses `swc src tests -d build --extensions .ts`. [VERIFIED: package.json + npm registry] [CITED: SWC CLI docs] |
| Node `node:test` + `node:assert` | built into Node | Unit tests and compatibility tests | Existing tests import `describe`/`it` from `node:test`; official Node docs show the same ESM pattern. [VERIFIED: tests/unit/cli/tools-meta.test.ts] [CITED: Context7 `/nodejs/node`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ESLint | package `^9.35.0`; npm latest `10.2.1` as of 2026-04-17 | Static style and import rules | Run `npm run check-format` before completion. [VERIFIED: package.json + npm registry + eslint.config.mjs] |
| Prettier | package `^3.6.2`; npm latest `3.8.3` as of 2026-04-15 | Formatting | Existing `check-format` invokes Prettier. [VERIFIED: package.json + npm registry + .prettierrc.cjs] |
| fast-check | package `^4.5.3`; npm latest `4.7.0` as of 2026-04-17 | Existing property tests | Do not add new property-test dependency; only use if extending current property tests. [VERIFIED: package.json + npm registry + tests/property/ToolRegistry.property.test.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing TypeScript interfaces | Runtime schema library | New dependency is out of scope; project already has static metadata and TypeScript compilation. [VERIFIED: user prompt + package.json] |
| Node `node:test` | Jest/Vitest | New test framework dependency is out of scope; current scripts already run Node test files from `build/tests`. [VERIFIED: user prompt + package.json] |
| Facade behind `tools-meta.ts` | Directly rewrite consumers to a new registry import | Rewriting consumers increases blast radius and contradicts REG-02 compatibility. [VERIFIED: .planning/REQUIREMENTS.md + GitNexus impact] |

**Installation:** No installation step; do not add dependencies. [VERIFIED: user prompt + .planning/PROJECT.md]

**Version verification:** Package versions above were checked with `npm view` on 2026-04-27 and local versions with `node --version`, `npm --version`, and `npx tsc --version`. [VERIFIED: shell probes]

## Architecture Patterns

### System Architecture Diagram

```text
Legacy TOOLS_META literal
        |
        v
Legacy domain manifest adapter
        |
        v
Registry facade: validate -> index by name -> expose ordered metadata
        |
        +--> getAllToolNames() --> CLI list-tools offline / REPL / worker registerAll / src/index.ts
        |
        +--> getToolMeta(name) --> ToolAdapter / tool-dispatcher / converted skill descriptions
        |
        +--> searchTools(query) --> tool-dispatcher suggestions / CLI search behavior
        |
        v
ToolAdapter keeps dynamic import by modulePath + handlerName and dispatches by callMode
```

This diagram reflects current data flow through `tools-meta.ts`, CLI commands, and `ToolAdapter`. [VERIFIED: source inspection + GitNexus context]

### Recommended Project Structure

```text
src/
├── cli/
│   ├── tools-meta.ts                 # public compatibility exports stay here
│   └── tool-registry/
│       ├── manifest.ts               # DomainManifest, ManifestToolEntry, validation types
│       ├── registry.ts               # facade assembly, duplicate detection, search
│       └── legacy-tools-manifest.ts  # adapter around existing TOOLS_META for Phase 1
└── worker/
    └── ToolAdapter.ts                # ideally unchanged in Phase 1

tests/
└── unit/
    └── cli/
        └── tool-registry.test.ts     # exact compatibility and validation tests
```

This structure keeps registry work in the CLI/shared metadata boundary and avoids importing handler modules. [VERIFIED: src/cli/tools-meta.ts + src/worker/ToolAdapter.ts]

### Pattern 1: Manifest Literals Checked With `satisfies`

**What:** Define manifest interfaces and declare manifest objects with `satisfies DomainManifest` so TypeScript validates shape while preserving literal metadata values. [CITED: TypeScript 4.9 official blog]

**When to use:** Use for `legacy-tools-manifest.ts` and future domain manifests. [VERIFIED: .planning/ROADMAP.md]

**Example:**

```typescript
import type {DomainManifest} from './manifest.js';

export const legacyToolsManifest = {
  domain: 'legacy',
  tools: TOOLS_META,
} satisfies DomainManifest;
```

Source: TypeScript `satisfies` preserves expression-specific type information while checking compatibility. [CITED: https://devblogs.microsoft.com/typescript/announcing-typescript-4-9/]

### Pattern 2: Build an Ordered Registry Index Once

**What:** Assemble manifests into an ordered `tools` array and a `Map<string, ToolMeta>` after validation. [VERIFIED: src/cli/tools-meta.ts currently builds `TOOLS_BY_NAME`]

**When to use:** Use at module initialization for current static metadata; avoid importing tool handlers. [VERIFIED: src/cli/tools-meta.ts + src/worker/ToolAdapter.ts]

**Example:**

```typescript
export interface ToolRegistrySnapshot {
  tools: ToolMeta[];
  byName: Map<string, ToolMeta>;
}

export function createToolRegistry(manifests: DomainManifest[]): ToolRegistrySnapshot {
  const tools = flattenAndValidateManifests(manifests);
  return {
    tools,
    byName: new Map(tools.map(tool => [tool.name, tool])),
  };
}
```

This mirrors the existing `TOOLS_BY_NAME` behavior while creating a seam for future manifests. [VERIFIED: source inspection]

### Pattern 3: Validate Metadata Without Handler Imports

**What:** Validate strings and metadata consistency only; do not dynamically import `src/tools/*` from registry validation. [VERIFIED: REG-03 + src/worker/ToolAdapter.ts]

**When to use:** Use for Phase 1 metadata validation and duplicate detection. [VERIFIED: .planning/ROADMAP.md]

**Example:**

```typescript
interface RegistryValidationIssue {
  code: 'duplicate-tool-name' | 'missing-handler-binding' | 'invalid-call-mode';
  toolName?: string;
  domain: string;
  message: string;
}
```

Returning structured validation issues gives tests stable assertions and gives future contributors enough context to fix metadata. [VERIFIED: .planning/REQUIREMENTS.md]

### Anti-Patterns to Avoid

- **Changing `ToolAdapter.wrapTool` dispatch in Phase 1:** `runtime`, `frame`, and `params-only` dispatch currently determines handler argument order. [VERIFIED: src/worker/ToolAdapter.ts]
- **Sorting tool names:** `getAllToolNames()` currently preserves `TOOLS_META` order, and REPL/CLI/registration consumers inherit that order. [VERIFIED: src/cli/tools-meta.ts + GitNexus context]
- **Importing handlers during metadata validation:** REG-03 requires loading metadata by domain without requiring all handler modules. [VERIFIED: .planning/REQUIREMENTS.md]
- **Replacing `TOOLS_META` export abruptly:** Tests and external imports use `TOOLS_META`; keep export compatible even if internally sourced from a facade. [VERIFIED: tests/unit/cli/tools-meta.test.ts + src/cli/index.ts]
- **Using regex/string replacement for registry migration:** Future migrations should move typed entries and preserve handler bindings. [VERIFIED: AGENTS.md GitNexus rename guidance + .planning/PROJECT.md]

## Implementation Approach

1. Add `src/cli/tool-registry/manifest.ts` with interfaces for domain manifest, dependency descriptor, prerequisite, workflow hint, and registry validation issue. [VERIFIED: REG-01]
2. Add `src/cli/tool-registry/registry.ts` with pure helpers: flatten manifests, validate metadata, detect duplicates, create ordered map, search by name/description. [VERIFIED: REG-02 + REG-04]
3. Move the current `TOOLS_META` literal minimally or wrap it as `legacyToolsManifest` without changing entry order. [VERIFIED: current count/order shell probe]
4. Keep `src/cli/tools-meta.ts` as the public compatibility module exporting `ToolMeta`, `ToolCallMode`, `TOOLS_META`, `getToolMeta`, `getAllToolNames`, and `searchTools`. [VERIFIED: source inspection + GitNexus context]
5. Do not modify handler modules in `src/tools/`. [VERIFIED: Phase 1 scope]
6. Avoid modifying `ToolAdapter.ts` unless a type import path update is unavoidable; if touched, run impact on `ToolAdapter`, `wrapTool`, and `registerAll`. [VERIFIED: AGENTS.md + GitNexus impact]

## Files Likely Touched

| File | Expected Change | Risk |
|------|-----------------|------|
| `src/cli/tools-meta.ts` | Preserve public exports; delegate internal data to facade or wrap existing literal in legacy manifest. [VERIFIED: source inspection] | HIGH for `getAllToolNames`; GitNexus reports 6 direct callers and 2 affected processes. [VERIFIED: GitNexus impact] |
| `src/cli/tool-registry/manifest.ts` | New type-only contract. [VERIFIED: REG-01] | LOW because new file. [VERIFIED: source inspection] |
| `src/cli/tool-registry/registry.ts` | New pure facade/validation helpers. [VERIFIED: REG-02 + REG-04] | LOW-MEDIUM because public exports may delegate here. [VERIFIED: GitNexus impact] |
| `src/cli/tool-registry/legacy-tools-manifest.ts` | Optional new adapter if the literal is split from `tools-meta.ts`. [VERIFIED: implementation recommendation] | MEDIUM because circular imports must be avoided. [VERIFIED: eslint.config.mjs import/no-cycle] |
| `tests/unit/cli/tools-meta.test.ts` | Strengthen current assertions to exact compatibility. [VERIFIED: existing test inspection] | LOW. [VERIFIED: test-only scope] |
| `tests/unit/cli/tool-registry.test.ts` | New validation and duplicate-name tests. [VERIFIED: REG-04] | LOW. [VERIFIED: test-only scope] |
| `tests/unit/worker/ToolAdapter.test.ts` | Optional registration-count test using `registerAll` with fake register function. [VERIFIED: src/worker/ToolAdapter.ts] | LOW-MEDIUM. [VERIFIED: existing ToolAdapter tests] |

## Existing Patterns to Preserve

- Public imports use `.js` extensions in TypeScript source, e.g. `../cli/tools-meta.js`. [VERIFIED: source inspection]
- Type imports are explicit and separated when values are not needed. [VERIFIED: eslint.config.mjs + src/worker/ToolAdapter.ts]
- Handler binding is string-based: `modulePath` plus `handlerName`. [VERIFIED: src/cli/tools-meta.ts]
- `ToolAdapter.loadHandler` converts `./domain/file.js` into `../tools/domain/file.js` at runtime. [VERIFIED: src/worker/ToolAdapter.ts]
- `callMode === 'runtime'` calls `handler(this.contextProvider, params)`. [VERIFIED: src/worker/ToolAdapter.ts]
- `callMode === 'frame'` resolves selected frame or page main frame and calls `handler(frame, params)`. [VERIFIED: src/worker/ToolAdapter.ts]
- Missing or unspecified `callMode` calls `handler(params)`. [VERIFIED: src/worker/ToolAdapter.ts]
- `searchTools` is case-insensitive for names and exact substring matching for Chinese descriptions. [VERIFIED: src/cli/tools-meta.ts + tests/unit/cli/tools-meta.test.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test framework | Custom runner or Jest-like wrapper | Node built-in `node:test` and `node:assert` | Existing scripts and tests already use Node test runner. [VERIFIED: package.json + tests/README.md] |
| Type contract checking | Runtime schema dependency | TypeScript interfaces plus `satisfies` | New dependencies are forbidden; TypeScript can validate static manifest literals. [VERIFIED: user prompt + TypeScript docs] |
| Handler loading | New loader system | Existing `ToolAdapter.loadHandler` dynamic import | Phase 1 must not change handler behavior; Node supports dynamic `import()` in ESM. [VERIFIED: src/worker/ToolAdapter.ts] [CITED: Node ESM docs] |
| Duplicate detection | Ad hoc silent overwrite in `Map` | Explicit validation before building map | Current `Map` would keep the last duplicate and lose context; REG-04 requires deterministic reporting. [VERIFIED: src/cli/tools-meta.ts + .planning/REQUIREMENTS.md] |
| Tool metadata baseline | Manual eyeballing | Exact automated assertions | Existing count assertion is too broad for Phase 1 compatibility. [VERIFIED: tests/unit/cli/tools-meta.test.ts] |

**Key insight:** Phase 1 is mostly about preserving metadata contracts while creating a better assembly point; any handler execution rewrite belongs to later phases. [VERIFIED: .planning/ROADMAP.md]

## Common Pitfalls

### Pitfall 1: Silent Duplicate Overwrite

**What goes wrong:** A duplicate tool name can be flattened into a `Map` where one entry overwrites another. [VERIFIED: src/cli/tools-meta.ts]
**Why it happens:** `new Map(TOOLS_META.map(t => [t.name, t]))` does not report duplicates. [VERIFIED: src/cli/tools-meta.ts]
**How to avoid:** Validate duplicate names before constructing the registry map and include domain, index, modulePath, and handlerName in the issue. [VERIFIED: REG-04]
**Warning signs:** Tests only compare set size or only check known names. [VERIFIED: tests/unit/cli/tools-meta.test.ts]

### Pitfall 2: Accidental Tool Reordering

**What goes wrong:** CLI list output, REPL completion, and worker registration order can change even though all tools still exist. [VERIFIED: source inspection + GitNexus context]
**Why it happens:** Sorting, grouping by domain, or flattening manifests in object-key order can alter `getAllToolNames()`. [VERIFIED: source inspection]
**How to avoid:** Preserve current ordered array in Phase 1 and add ordered-name assertions. [VERIFIED: shell probe + REG-02]
**Warning signs:** Tests compare sorted names rather than exact order. [VERIFIED: tests/unit/cli/tools-meta.test.ts]

### Pitfall 3: Import Cycles After Splitting Files

**What goes wrong:** `tools-meta.ts` imports registry, registry imports legacy manifest, and legacy manifest imports `TOOLS_META` from `tools-meta.ts`. [VERIFIED: source inspection]
**Why it happens:** Moving the literal without a clear ownership boundary creates circular imports. [VERIFIED: eslint.config.mjs import/no-cycle]
**How to avoid:** Put the literal in exactly one module and have `tools-meta.ts` only re-export facade output, or keep the literal in `tools-meta.ts` and have the facade accept it as input. [VERIFIED: implementation analysis]
**Warning signs:** ESLint `import/no-cycle` failures or runtime undefined metadata. [VERIFIED: eslint.config.mjs]

### Pitfall 4: Handler Imports During Validation

**What goes wrong:** Metadata tests become slow or require browser/handler dependencies. [VERIFIED: REG-03 + src/worker/ToolAdapter.ts]
**Why it happens:** Validation tries to verify that every `modulePath` physically imports and has `handlerName`. [VERIFIED: implementation analysis]
**How to avoid:** Phase 1 validation should check metadata shape only; handler existence tests can remain targeted and later. [VERIFIED: Phase 1 scope]
**Warning signs:** Unit test starts importing `src/tools/*` or launching browser services. [VERIFIED: tests/README.md]

### Pitfall 5: Changing `ToolMeta` Strictness Too Much

**What goes wrong:** Existing metadata or downstream imports fail due to a stricter type contract unrelated to Phase 1 behavior. [VERIFIED: tsconfig.json has `strict: false` and current schemas are simple strings]
**Why it happens:** Over-modeling dependencies/prerequisites in the first phase. [VERIFIED: REG-01 + Phase 3 scope]
**How to avoid:** Add optional fields for dependencies/prerequisites/workflow hints but do not require them for legacy entries. [VERIFIED: .planning/ROADMAP.md]
**Warning signs:** Planner includes edits across many tool entries just to satisfy new required fields. [VERIFIED: Phase 1 scope]

## Code Examples

### Compatibility Export Shape

```typescript
export const TOOLS_META: ToolMeta[] = registry.tools;

export function getToolMeta(name: string): ToolMeta | undefined {
  return registry.byName.get(name);
}

export function getAllToolNames(): string[] {
  return registry.tools.map(tool => tool.name);
}
```

This preserves the existing public API and return shapes. [VERIFIED: src/cli/tools-meta.ts]

### Exact Handler Mapping Assertion

```typescript
const mapping = TOOLS_META.map(tool => ({
  name: tool.name,
  modulePath: tool.modulePath,
  handlerName: tool.handlerName,
  callMode: tool.callMode ?? 'params-only',
}));

assert.deepStrictEqual(mapping, expectedToolMappings);
```

This catches handler mapping drift without importing handlers. [VERIFIED: REG-03 + REG-04]

### Duplicate Detection Fixture

```typescript
assert.throws(
  () => createToolRegistry([manifestA, manifestB]),
  /Duplicate tool name "query_dom".*domainA.*domainB/u,
);
```

This proves deterministic duplicate reporting independent of production metadata. [VERIFIED: REG-04]

## Current Metadata Baseline

| Property | Current Value | Source |
|----------|---------------|--------|
| Tool count | 145 | [VERIFIED: `node --experimental-strip-types` source probe] |
| First tool | `observe_flow` | [VERIFIED: `node --experimental-strip-types` source probe] |
| Last tool | `fill` | [VERIFIED: `node --experimental-strip-types` source probe] |
| Call modes | `params-only`: 12, `runtime`: 74, `frame`: 59 | [VERIFIED: `node --experimental-strip-types` source probe] |
| Existing duplicate-name test | Present | [VERIFIED: tests/unit/cli/tools-meta.test.ts] |
| Existing exact count test | Missing; current test asserts `>= 80` | [VERIFIED: tests/unit/cli/tools-meta.test.ts] |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain object annotation for manifest literals | `satisfies` for shape validation while preserving literal inference | TypeScript 4.9, 2022-11-15 | Use `satisfies DomainManifest` for manifests. [CITED: TypeScript 4.9 official blog] |
| External test framework by default | Node built-in test runner for this project | Existing repo convention | Continue using `node:test`; no new test dependencies. [VERIFIED: package.json + tests/README.md] [CITED: Node test docs] |
| Static handler imports in registry | String handler binding plus dynamic import at execution boundary | Existing repo convention | Keep registry metadata-only and let `ToolAdapter` load handlers. [VERIFIED: src/cli/tools-meta.ts + src/worker/ToolAdapter.ts] |

**Deprecated/outdated:**
- Treating `TOOLS_META` as the long-term source of truth is outdated for this project cycle; it should become compatibility output from manifest-backed registry over phases. [VERIFIED: .planning/PROJECT.md + .planning/ROADMAP.md]
- Broad count assertions like `>= 80` are inadequate for Phase 1 compatibility. [VERIFIED: tests/unit/cli/tools-meta.test.ts + .planning/ROADMAP.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | No unverified assumptions were used as planning-critical facts. | — | — |

## Open Questions

1. **Where should the 145-tool compatibility baseline live?** [VERIFIED: current count shell probe]
   - What we know: Tests must fail if names disappear or handler mapping changes. [VERIFIED: .planning/ROADMAP.md]
   - What's unclear: Whether maintainers prefer inline expected arrays or a checked-in JSON fixture. [VERIFIED: project docs do not specify]
   - Recommendation: Use a TypeScript fixture under `tests/unit/cli/` or inline expected mapping in `tool-registry.test.ts`; do not generate it during test execution. [VERIFIED: test stability analysis]

2. **Should duplicate validation throw at module import or be exposed as a testable helper?** [VERIFIED: REG-04]
   - What we know: Production duplicates should fail deterministically. [VERIFIED: .planning/REQUIREMENTS.md]
   - What's unclear: Whether import-time failure is acceptable for CLI startup. [VERIFIED: source inspection]
   - Recommendation: Keep pure `validateToolRegistry()` helper and have `createToolRegistry()` throw when issues exist; tests can assert both structured issues and throw behavior. [VERIFIED: implementation analysis]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build and tests | Yes | `v22.14.0` | None needed; satisfies package engine. [VERIFIED: shell probe + package.json] |
| npm | package scripts | Yes | `11.8.0` | None needed. [VERIFIED: shell probe] |
| TypeScript CLI | typecheck | Yes | `5.9.3` local | Use `npm run typecheck`. [VERIFIED: shell probe + package.json] |
| GitNexus MCP | impact analysis | Yes | Repo indexed as `JSReverser-MCP` | If stale warning appears, run `npx gitnexus analyze`. [VERIFIED: CLAUDE.md + GitNexus tool responses] |
| GSD graphify | optional graph context | No | disabled | Continue with source inspection and GitNexus. [VERIFIED: graphify status] |

**Missing dependencies with no fallback:** None for Phase 1 planning. [VERIFIED: environment audit]

**Missing dependencies with fallback:** GSD graphify is disabled; GitNexus and source inspection provide adequate context. [VERIFIED: graphify status + GitNexus context]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` with `node:assert`. [VERIFIED: tests/README.md + Node docs] |
| Config file | `tests/setup.ts` / compiled `build/tests/setup.js`; scripts load setup with `--require`. [VERIFIED: package.json + tests file list] |
| Quick run command | `npm run test:unit -- --test-name-pattern=tools-meta` is not supported by the current npm script shape; use targeted built output after build if needed. [VERIFIED: package.json + Node test docs] |
| Practical quick command | `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/cli/tools-meta.test.js build/tests/unit/cli/tool-registry.test.js build/tests/unit/worker/ToolAdapter.test.js` [VERIFIED: package.json] |
| Full suite command | `npm test` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REG-01 | Manifest type accepts current legacy metadata and optional future dependency/prerequisite/hint fields. [VERIFIED: .planning/REQUIREMENTS.md] | type/unit | `npm run typecheck` | New file needed. |
| REG-02 | `getAllToolNames`, `getToolMeta`, `searchTools`, and `TOOLS_META` remain compatible. [VERIFIED: source inspection] | unit | targeted CLI metadata test command above | Existing file, strengthen needed. |
| REG-03 | Registry metadata assembly does not import handler modules. [VERIFIED: .planning/REQUIREMENTS.md] | unit/static | targeted CLI metadata test command above | New assertion needed. |
| REG-04 | Duplicate tool names produce deterministic error context. [VERIFIED: .planning/REQUIREMENTS.md] | unit | targeted CLI metadata test command above | New file needed. |
| SAFE-01 | Impact analysis is run before implementation edits. [VERIFIED: .planning/REQUIREMENTS.md + AGENTS.md] | process/manual evidence | GitNexus `impact` before edits; `detect_changes` before commit | Planner task needed. |

### Sampling Rate

- **Per task commit:** run targeted registry tests plus `npm run typecheck`. [VERIFIED: package.json]
- **Per wave merge:** run `npm run test:unit` and `npm run check-format`. [VERIFIED: package.json + AGENTS.md]
- **Phase gate:** run `npm test`, `npm run typecheck`, and `npm run check-format`. [VERIFIED: package.json + AGENTS.md]

### Wave 0 Gaps

- [ ] `tests/unit/cli/tool-registry.test.ts` — covers REG-01, REG-03, REG-04. [VERIFIED: file list]
- [ ] Strengthen `tests/unit/cli/tools-meta.test.ts` — covers exact REG-02 compatibility. [VERIFIED: current test inspection]
- [ ] Optional `tests/unit/worker/ToolAdapter.test.ts` registration-count test — covers worker registration compatibility. [VERIFIED: current ToolAdapter test inspection]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No | Phase 1 edits metadata only and does not change auth paths. [VERIFIED: Phase 1 scope] |
| V3 Session Management | No | Phase 1 must not touch session handler behavior. [VERIFIED: Phase 1 scope + src/cli/tools-meta.ts session entries] |
| V4 Access Control | No | Registry facade does not introduce user authorization logic. [VERIFIED: Phase 1 scope] |
| V5 Input Validation | Yes | Validate manifest metadata shape and supported `callMode` values before exposing registry. [VERIFIED: REG-04 + src/cli/tools-meta.ts] |
| V6 Cryptography | No | Phase 1 does not implement cryptographic primitives. [VERIFIED: Phase 1 scope] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Handler path drift causing wrong tool execution | Tampering | Exact `name -> modulePath:handlerName:callMode` compatibility tests. [VERIFIED: src/worker/ToolAdapter.ts + .planning/ROADMAP.md] |
| Metadata validation importing untrusted or heavy handler modules | Denial of Service | Keep registry validation metadata-only; only `ToolAdapter` performs dynamic import at execution time. [VERIFIED: REG-03 + src/worker/ToolAdapter.ts] |
| License contamination from AGPL source copy | Legal/compliance risk | Reimplement concepts independently and cite design only. [VERIFIED: .planning/PROJECT.md + .planning/research/SUMMARY.md] |

## Explicit Planner Guidance

- Make the first implementation task a GitNexus impact pass for `getAllToolNames`, `getToolMeta`, `searchTools`, `TOOLS_META`, and any touched `ToolAdapter` symbol. [VERIFIED: AGENTS.md + GitNexus impact]
- Add compatibility tests before or in the same first edit as the facade; do not wait until after registry refactor. [VERIFIED: .planning/ROADMAP.md]
- Preserve exact ordered output of `getAllToolNames()`; do not sort by domain or name. [VERIFIED: src/cli/tools-meta.ts]
- Preserve `ToolMeta` fields and optional `callMode` semantics. [VERIFIED: src/cli/tools-meta.ts + src/worker/ToolAdapter.ts]
- Implement duplicate-name detection in a pure helper with fixture manifests. [VERIFIED: REG-04]
- Avoid touching `src/tools/**` in Phase 1. [VERIFIED: Phase 1 scope]
- Avoid changing `ToolAdapter.wrapTool` unless absolutely necessary; public metadata facade work should not require it. [VERIFIED: source inspection]
- Do not add dependencies; use TypeScript, Node test runner, and existing package scripts. [VERIFIED: user prompt + package.json]
- Before committing, run GitNexus `detect_changes()` and include expected affected symbols in the handoff. [VERIFIED: AGENTS.md]

## Sources

### Primary (HIGH confidence)

- `.planning/PROJECT.md` — project goals, constraints, license boundary, architecture direction. [VERIFIED: source file]
- `.planning/ROADMAP.md` — Phase 1 scope and success criteria. [VERIFIED: source file]
- `.planning/REQUIREMENTS.md` — REG-01 through REG-04 and SAFE-01 definitions. [VERIFIED: source file]
- `.planning/STATE.md` — current focus and known constraints. [VERIFIED: source file]
- `.planning/research/SUMMARY.md` — prior design research and license boundary. [VERIFIED: source file]
- `AGENTS.md` and `CLAUDE.md` — project coding, testing, GitNexus, and safety constraints. [VERIFIED: source files]
- `src/cli/tools-meta.ts` — current metadata API and 145-tool source table. [VERIFIED: source inspection]
- `src/worker/ToolAdapter.ts` — dynamic import, call mode dispatch, and worker registration. [VERIFIED: source inspection]
- `src/cli/commands/list-tools.ts` — offline list-tools fallback uses metadata functions. [VERIFIED: source inspection]
- `src/cli/commands/tool-dispatcher.ts` — dispatch and suggestions use `getToolMeta` and `searchTools`. [VERIFIED: source inspection]
- `tests/README.md`, `tests/unit/cli/tools-meta.test.ts`, `tests/unit/worker/ToolAdapter.test.ts` — current test conventions and gaps. [VERIFIED: source inspection]
- GitNexus context/impact for `getAllToolNames`, `getToolMeta`, `searchTools`, and `ToolAdapter`. [VERIFIED: GitNexus MCP]
- Context7 `/nodejs/node` docs for `node:test` ESM `describe`/`it`. [CITED: https://github.com/nodejs/node/blob/main/doc/api/test.md]
- TypeScript official 4.9 blog for `satisfies`. [CITED: https://devblogs.microsoft.com/typescript/announcing-typescript-4-9/]
- Node ESM docs for dynamic `import()`. [CITED: https://nodejs.org/api/esm.html]
- SWC CLI docs for existing build tool context. [CITED: https://swc.rs/docs/usage/cli]
- npm registry checks for TypeScript, SWC, ESLint, Prettier, fast-check. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- None needed. [VERIFIED: source hierarchy review]

### Tertiary (LOW confidence)

- None used. [VERIFIED: source hierarchy review]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing package scripts and npm registry versions verified. [VERIFIED: package.json + npm registry]
- Architecture: HIGH — source consumers and GitNexus impact verified. [VERIFIED: source inspection + GitNexus]
- Pitfalls: HIGH — derived from current implementation and explicit Phase 1 requirements. [VERIFIED: source inspection + .planning/REQUIREMENTS.md]
- Test strategy: HIGH — current Node test setup and gaps verified. [VERIFIED: package.json + tests/README.md + test files]

**Research date:** 2026-04-27 [VERIFIED: current_date]
**Valid until:** 2026-05-27 for repo-local architecture; re-check npm/package versions if dependency decisions change. [VERIFIED: research judgment based on current sources]
