# Upstream Features & Fixes Integration Design

- **Date:** 2026-09-12
- **Topic:** Porting key capabilities and fixes from `chrome-devtools-mcp` (v1.9.0+) to `Reverser-CLI`
- **Status:** Rev 2 — grounded against actual Reverser-CLI code paths (axi-sdk-js CLI, tool-arg-validator pipeline, manifest generation chain)
- **Revision note:** Rev 1 assumed Yargs CLI, runtime Zod enforcement, and upstream's `conditions` gating. Code review proved all three absent; see §3.2/§3.3/§3.5 for the corrected mechanisms.

---

## 1. Background & Motivation

`Reverser-CLI` is specialized for web reverse engineering, dynamic hooking, and browser automation built on `Patchright`. Upstream `chrome-devtools-mcp` recently released version 1.9.0 and multiple post-1.9.0 improvements, including:
1. `get_css_styles` tool and comprehensive CSS cascade formatting (`CssFormatter`).
2. CLI configuration file support (`--config <path>`).
3. Strict bounds and type validation for emulation tools (`resize_page`, `emulate_mobile`, etc.).
4. Preservation of console and network history across same-document (SPA) navigations.
5. DevTools AI comment collaboration tools (`open_devtools`, `get_devtools_comments`, `resolve_devtools_comment`, `reveal_in_devtools`).

This design specifies the architectural integration of these capabilities into `Reverser-CLI`, adhering to lightweight, fast-compiling (SWC), zero-bloat principles without importing the heavyweight Chromium devtools-frontend submodule.

---

## 2. Architecture & Components

```
src/
├── cli/
│   ├── app.ts                        # [修改] createWorkerContext 合并配置文件 → spawnFlags
│   ├── sessionArgs.ts                # [修改] DAEMON_VALUE_FLAGS 增加 browserUrl/wsEndpoint/executablePath
│   └── commands/
│       └── config.ts                 # [修改] VALID_KEYS 扩展 spawn 相关键
├── modules/
│   └── collector/
│       └── PageCollector.ts          # [修改] 识别并放行 SPA Same-Document Navigation
├── formatters/
│   └── cssFormatter.ts               # [新增] 原生 CDP 样式与 Cascade 层叠格式化引擎
├── tools/
│   ├── css/                          # [新增] 样式调试工具域
│   │   ├── manifest.ts               #        （由 generate-tools-index 生成）
│   │   └── getCssStyles.ts           #        get_css_styles: selector 定位 + CDP 样式获取
│   ├── devtools/                     # [新增] DevTools 协作工具域 (profile: 'full')
│   │   ├── manifest.ts               #        （由 generate-tools-index 生成）
│   │   ├── openDevtools.ts
│   │   ├── getDevtoolsComments.ts    #        stub：桥接不可用时返回降级提示
│   │   ├── resolveDevtoolsComment.ts #        stub：同上
│   │   └── revealInDevtools.ts       #        Overlay.highlightNode 最小实现
│   ├── emulation/
│   │   └── resizePage.ts             # [修改] schema 增加 int/min/max 约束
│   ├── zod-introspect.ts             # [修改] ToolArgSpec 提取 range（min/max/int）
│   └── tool-arg-validator.ts         # [修改] number 分支强制 range 校验
scripts/
└── generate-tools-index.ts           # [修改] DOMAIN_DESCRIPTIONS 增加 css / devtools 域
tests/unit/                           # [镜像新增] 见 §4 测试计划
```

---

## 3. Subsystem Specifications

### 3.1 CSS Inspection & Formatting (`get_css_styles` & `cssFormatter.ts`)

#### Goal
Allow reverse engineers and agents to inspect matched CSS rules, computed overrides, pseudo elements, and cascade specificity on any DOM element.

#### Interaction Model (grounded)
- **Selector-first**: Accepts `selector` matching Reverser-CLI's standard locator semantics (the locator resolution mechanism already exists in `src/tools/shared/elementLocator.ts`, and `query_dom` / `click` reuse it; this tool does the same).
- **CDP Communication**: The project already has the mature `withCdpSession(page, fn)` utility (`src/modules/browser/cdpUtils.ts`) and the lazy-activation pattern; use it to directly call:
  - `DOM.getDocument` + `DOM.querySelector` (or `DOM.getNodeForSelector`) to resolve the target element's `nodeId`
  - `CSS.getMatchedStylesForNode({ nodeId })` to fetch rules and properties
  - `CSS.getComputedStyleForNode` (optional, for computed-values comparison)
- **Note on the reverse-engineering scenario**: CDP `CSS.getMatchedStylesForNode` returns style rules as seen by the engine (including `matchedCSSRules` / `pseudoElements` / `inherited` / `inlineStyle` / `attributesStyle`); the formatter's job is to reduce this raw structure to a readable cascade report.
- **Formatting Engine**:
  - Computes property states: `active` (winning), `overloaded` (overridden by higher specificity or later declaration), `disabled`.
  - Parses pseudo-elements (`::before`, `::after`) and inherited style chains.
  - Supports pagination (`pageSize`, `pageIdx`) to prevent overwhelming LLM context on complex frontend layouts.
- **Category**: `ToolCategory.DEBUGGING` (no new category value is added; `categories.ts` stays untouched).
- **Registration**: add the `css` domain to `DOMAIN_DESCRIPTIONS` in `scripts/generate-tools-index.ts`, regenerating indexes via the `npm run build` chain.

---

### 3.2 CLI Configuration File Support (`--config`)

> **Rev 2 correction:** Rev 1 assumed a Yargs CLI. In fact, the `proxycli` command layer is built on `axi-sdk-js` with a hand-rolled lightweight flag parser (`src/cli/args-parser.ts::parseArgs`), and only the legacy worker entry `parseArguments()` uses Yargs (and is dead code — no callers). Additionally, the project already has a config-file mechanism: `~/.proxycli/config.json` via `proxycli config --set key=value` (`src/cli/commands/config.ts`), currently only supporting the `workerEntry` key.

#### Goal
Allow users to define browser/runtime spawn options (headless, cloak, js-stealth, browserUrl, etc.) in a JSON configuration file so that they are passed through automatically when the daemon spawns, without having to repeat them on every command line.

#### Implementation (grounded)
1. **Extend config file**: in `src/cli/commands/config.ts`:
   - Extend `VALID_KEYS` to add spawn-related keys: `headless` (boolean), `cloak` (boolean), `jsStealth` (boolean), `fullStealthArgs` (boolean), `minimalStealth` (boolean), `browserUrl` (string), `wsEndpoint` (string), `executablePath` (string).
   - Persist in the existing `~/.proxycli/config.json` (overridable via `PROXYCLI_CONFIG_DIR` for test isolation, mechanism already in place).
2. **Merge configuration into spawnFlags**: in `src/cli/app.ts::createWorkerContext`, after `spawnFlagsFromArgv(argv)`, read config-file boolean keys and append the corresponding `--flag` (headless → `--headless`, jsStealth → `--js-stealth`, …); for value keys like `browserUrl`, append `--browserUrl <value>`. **Explicit command-line flags take precedence**: skip a config-derived flag if the same flag already exists in `argv`.
3. **Worker-side consumption**: the flags are already recognized by `src/ipc/daemonArgs.ts::buildDaemonArgPlan` (daemon-specific tokens) and `src/worker/WorkerArgs.ts::parseWorkerArgs` (BOOLEAN_FLAGS / VALUE_FLAGS); only the three value keys `browserUrl` / `wsEndpoint` / `executablePath` need to be added to the `DAEMON_SPAWN_FLAGS` / `DAEMON_VALUE_FLAGS` whitelists in `src/cli/sessionArgs.ts` (they must be passed in `--flag=value` form to satisfy the whitelist check; the merge logic in step 2 must therefore output the `=` form).
4. **Environment variables still take priority**: keeping the existing semantics, `PROXYCLI_ENTRY`/`BROWSERCLI_ENTRY` is not affected by the configuration file.
5. **No new `--config` flag is introduced**: reusing the existing `proxycli config` command system avoids two configuration entry points. (If a "specify a config file in the current directory" need arises in the future, it can be added later — YAGNI.)

#### Rationale for not using Yargs `.config()`
`parseArguments()` is only called by dead code; the active CLI (bin/proxycli.js → axi-sdk-js → app.ts) doesn't go through Yargs. Introducing Yargs config would have to change the entire command-dispatch architecture, and the gain doesn't justify the cost.

---

### 3.3 Emulation Input Validation

> **Rev 2 correction:** Rev 1 assumed Zod schema runtime enforcement. In fact, `ToolExecutionPipeline` uses the custom `src/tools/tool-arg-validator.ts::validateToolArgs`, whose `ToolArgSpec` (from `zod-introspect.ts`) only extracts type/required/enum/defaultValue — **`.min()/.max()/.int()` constraints are completely lost**. Zod schemas are only documentation for tool arg discovery; they are not executed at runtime.

#### Goal
Prevent invalid coordinates, dimensions, or negative numbers from reaching CDP and causing uncaught protocol crashes.

#### Implementation (grounded)
Two layers, minimal diff:

1. **Schema layer (descriptive)**: update the Zod schema in the tool definitions to include the constraints (so the generated docs/CLI help text is correct):
   - `resize_page`: `width`/`height`: `zod.number().int().min(1).max(10000)`
   - `emulate_cpu`: `throttlingRate`: `min(1).max(20)` (already in place; just keep it)
   - `emulate_mobile`: device values are fixed by `DEVICE_PROFILES`; validation is not needed (unknown devices are already handled by normalizeDevice).
2. **Runtime layer (effective)**: add a `range` field to `ToolArgSpec` in `src/tools/zod-introspect.ts`, extracted from `zod.ZodNumber`'s `_def.checks` (min/max/int/finite); then enforce it in `validateToolArgs`'s `case 'number':` branch in `src/tools/tool-arg-validator.ts`. This benefits all numeric parameters across the whole toolset (not just emulation tools) — one mechanism, no per-tool wiring.
   - Error message format consistent with existing conventions: `${toolName} 的参数 ${key} 必须是不超过 10000 的正整数`.
3. `emulate_mobile` has no latitude/longitude input at present (Rev 1 was an incorrect assumption based on upstream; the local implementation only has enable/device). Geolocation validation is not introduced (YAGNI; add it if a geolocation tool is added later).

---

### 3.4 SPA Same-Document Navigation History Preservation

> **Rev 2 note:** Reverser-CLI's `PageCollector` is architecturally different from upstream (WeakMap keyed by page, subclasses override `splitOnNavigation`), but the bug is isomorphic: in `attachToPage`, `page.on('framenavigated')` also unconditionally calls `splitOnNavigation` for same-document navigations.

#### Problem
In `src/modules/collector/PageCollector.ts`, `framenavigated` fires whenever the URL changes. In Single Page Applications (SPA), client-side pushState/replaceState changes trigger `framenavigated`, which currently invokes `splitOnNavigation(page)` and rotates out console logs and network requests prematurely.

#### Solution (grounded)
1. In `attachToPage`, use the frame's `navigatedWithinDocument` event (Patchright/Playwright Frame API has this event, corresponding to CDP `Page.navigatedWithinDocument`) to set a `pendingSameDocumentNavigation = true` mark.
2. In the `framenavigated` handler, consume the mark: if the mark is true, it's a same-document navigation — skip `splitOnNavigation`.
3. Upstream also re-attaches the frame listener after cross-document navigations (the frame object may be replaced). Patchright's Frame lifecycle is managed by Playwright, and `page.mainFrame()` returns a stable wrapper; when actually implementing, first verify whether Frame object replacement happens (write a probe test); if it does, follow upstream's re-attach logic; if not, register once.
4. Affected subclasses: the `splitOnNavigation` overrides of `NetworkRequestCollector` / `WsCollector` (src/worker/collectors.ts) share the base class's trigger path; skipping the split naturally happens in the base class, and subclasses require no changes.

---

### 3.5 DevTools AI Collaboration Tools (`devtoolsComments`)

> **Rev 2 correction:** Rev 1 assumed the project had upstream's `conditions`/`toolProfile` conditional-filtering mechanism. In fact, Reverser-CLI only has two profiles: `workflow`/`full` (`src/tools/manifest.ts::ToolProfile`), with no runtime conditional activation mechanism. Also, the upstream CD4A bridge depends on `window.universe.cd4aBridge` inside the DevTools frontend — a custom API requiring a specific devtools-frontend build — which cannot work with a stock Chrome window driven via Patchright.

#### Goal
Expose bridge tools to collaborate with a Chrome DevTools window when explicitly enabled.

#### Implementation (grounded, de-scoped from upstream)
1. **Gating mechanism**: reuse the existing `ToolProfile` system:
   - The 4 tools are registered with `profile: 'full'` in `src/tools/devtools/manifest.ts` — hidden by default (`workflow` is the everyday profile). No new condition system is invented.
   - At the same time, add a `devtoolsComments` boolean key to the config file (§3.2), allowing users to persist the preference; the runtime check is performed inside handlers: if the DevTools window cannot be reached, an explicit degradation notice is returned.
2. **open_devtools**: for the selected page, resolve the DevTools WS endpoint via `page.context().newCDPSession(page)` + the `wsEndpoint`/`devtoolsFrontendUrl` returned by CDP `Target.getTargets` (or the local `http://127.0.0.1:<port>/json/list` HTTP endpoint), and launch it with the system default browser (`start`/`open`). Headless mode requires special handling: with `--headless` there is no frontend window — the tool returns guidance text directly.
3. **get_devtools_comments / resolve_devtools_comment**: the upstream implementation relies on DevTools frontend custom builds injecting the `cd4aBridge`; the stock frontend has no such API. This iteration implements a **stub**: when the bridge is unavailable it returns a clear "CD4A bridge not supported in current DevTools frontend" notice, keeping the tool contract (schema/annotations/tests) in place so the implementation can be filled in later if Chrome ships the API upstream.
4. **reveal_in_devtools**: with the DevTools window open, use CDP `Overlay.bringToFront` / DOM highlight (`Overlay.highlightNode` for the given selector's `backendNodeId`) as a minimal viable implementation (Elements-panel highlighting); panel navigation requires the frontend's UI command channel, which is similarly stubbed with a degradation notice.
5. **New domain registration**: add `devtools: 'DevTools window collaboration tools.'` to `DOMAIN_DESCRIPTIONS` in `scripts/generate-tools-index.ts`, then run `npm run build` to regenerate `src/tools/generated-tools-index.ts` and each domain's `manifest.ts` (the build chain runs `build:index` → `generate-tools-index.ts` → `build:post`).

---

## 4. Verification & Testing Plan

1. **Unit Tests** (mirroring src/ directory structure, node:test + existing mock infrastructure):
   - `tests/unit/formatters/cssFormatter.test.ts`: Verify rule parsing, cascade overrides, pseudo elements, and pagination (pure-function testing with CDP mock return structures, no browser needed).
   - `tests/unit/tools/css/getCssStyles.test.ts`: Test `get_css_styles` with mock CDP session and various selectors.
   - `tests/unit/tools/tool-arg-validator-range.test.ts`: Test the new `range` extraction and enforcement (int/min/max rejection).
   - `tests/unit/cli/configSpawnFlags.test.ts`: Verify config-file boolean/value keys merge into spawnFlags, and command-line precedence.
   - `tests/unit/collector/PageCollectorSpa.test.ts`: Verify history retention during same-document routing (mock Frame emitting `navigatedWithinDocument` then `framenavigated`).
   - DevTools tools: handler-level degrade-notice tests (no browser needed).
2. **Quality Gates** (final-diff-scoped, per CLAUDE.md):
   - `npm run typecheck`
   - `npm run test:unit`（至少包含新增测试所在目录）
   - `npm run check-format`
   - `npm run build`（验证 generate-tools-index 重新生成 css/devtools 域无报错）
