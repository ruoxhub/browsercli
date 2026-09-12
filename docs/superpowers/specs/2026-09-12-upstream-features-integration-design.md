# Upstream Features & Fixes Integration Design

- **Date:** 2026-09-12
- **Topic:** Porting key capabilities and fixes from `chrome-devtools-mcp` (v1.9.0+) to `Reverser-CLI`
- **Status:** Approved / In Review

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
│   └── args-parser.ts                 # Add --config option with yargs.config('config', ...)
├── modules/
│   └── collector/
│       └── PageCollector.ts           # Handle same-document (SPA) navigations
├── formatters/
│   └── cssFormatter.ts                # Native CDP CSS cascade formatter (rules, specificity, pagination)
├── tools/
│   ├── css/                           # CSS debugging tools
│   │   ├── index.ts
│   │   ├── manifest.ts
│   │   ├── types.ts
│   │   └── getCssStyles.ts            # get_css_styles tool with selector support
│   ├── devtools/                      # DevTools collaboration tools (conditional)
│   │   ├── index.ts
│   │   ├── manifest.ts
│   │   ├── types.ts
│   │   ├── openDevtools.ts
│   │   ├── getDevtoolsComments.ts
│   │   ├── resolveDevtoolsComment.ts
│   │   └── revealInDevtools.ts
│   └── emulation/                     # Schema validation hardening
│       ├── resizePage.ts              # width/height validation (positive integers, bounds)
│       └── emulateMobile.ts           # viewport/geolocation validation
```

---

## 3. Subsystem Specifications

### 3.1 CSS Inspection & Formatting (`get_css_styles` & `cssFormatter.ts`)

#### Goal
Allow reverse engineers and agents to inspect matched CSS rules, computed overrides, pseudo elements, and cascade specificity on any DOM element.

#### Interaction Model
- **Selector-first**: Accepts `selector` (CSS, XPath, text selector) to match Reverser-CLI's standard locator semantics; optionally accepts `uid` for snapshot compatibility.
- **CDP Communication**: Uses standard CDP domain commands:
  - `DOM.enable`, `CSS.enable`
  - `DOM.querySelector` to resolve target element node ID
  - `CSS.getMatchedStylesForNode({ nodeId })` to fetch rules and properties
- **Formatting Engine**:
  - Computes property states: `active` (winning), `overloaded` (overridden by higher specificity or later declaration), `disabled`.
  - Parses pseudo-elements (`::before`, `::after`), `@keyframes`, and inherited styles.
  - Supports pagination (`pageSize`, `pageIdx`) to prevent overwhelming LLM context on complex frontend layouts.

---

### 3.2 CLI Configuration File Support (`--config`)

#### Goal
Allow developers to define reusable runtime options (remote debugging URL, proxy, headless mode, token, feature flags) in a JSON configuration file.

#### Implementation
In `src/cli/args-parser.ts`:
- Define `config` option in `cliOptions`:
  ```typescript
  config: {
    type: 'string',
    description: 'Path to a JSON configuration file to load options from.',
    normalize: true,
  }
  ```
- Register via Yargs `.config('config', 'Path to JSON configuration file to load options from')`.
- Explicit command-line flags take precedence over values in the JSON config.

---

### 3.3 Emulation Input Validation

#### Goal
Prevent invalid coordinates, dimensions, or negative numbers from reaching CDP and causing uncaught protocol crashes.

#### Validation Rules
- `resize_page`:
  - `width`: `zod.number().int().min(1).max(10000)`
  - `height`: `zod.number().int().min(1).max(10000)`
- `emulate_mobile`:
  - `viewport.width` / `viewport.height`: `min(1).max(10000)`
  - `geolocation.latitude`: `min(-90).max(90)`
  - `geolocation.longitude`: `min(-180).max(180)`
  - `geolocation.accuracy`: `min(0)`
- `emulate_cpu`:
  - `rate`: `zod.number().min(1).max(100)`

---

### 3.4 SPA Same-Document Navigation History Preservation

#### Problem
In `src/modules/collector/PageCollector.ts`, `framenavigated` fires whenever the URL changes. In Single Page Applications (SPA), client-side pushState/replaceState changes trigger `framenavigated`, which currently invokes `splitOnNavigation(page)` and rotates out console logs and network requests prematurely.

#### Solution
- Check navigation metadata or listen to CDP `Page.navigatedWithinDocument` / `history` URL changes to detect in-page routing.
- When an in-page navigation occurs without a full document reload, suppress `splitOnNavigation`, preserving active console and network history.

---

### 3.5 DevTools AI Collaboration Tools (`devtoolsComments`)

#### Goal
Expose bridge tools to collaborate with Chrome DevTools window when `--devtools-comments` is enabled.

#### Tools
1. `open_devtools`: Opens inspector/devtools window for the selected page.
2. `get_devtools_comments`: Reads CD4A thread comments from DevTools.
3. `resolve_devtools_comment`: Appends agent resolution text to a comment thread.
4. `reveal_in_devtools`: Navigates DevTools to a panel (Elements/Network) and highlights the target node or request.

#### Guarding
- Guarded by condition `devtoolsComments` in tool annotations, activated only when the flag/config is passed.
- Graceful degradation: returns clear guidance if no DevTools window or CD4A bridge is available.

---

## 4. Verification & Testing Plan

1. **Unit Tests**:
   - `tests/unit/formatters/cssFormatter.test.ts`: Verify rule parsing, cascade overrides, pseudo elements, and pagination.
   - `tests/unit/tools/getCssStyles.test.ts`: Test `get_css_styles` with mock CDP session and various selectors.
   - `tests/unit/tools/emulationValidation.test.ts`: Test bounds rejection on invalid viewport/geolocation inputs.
   - `tests/unit/cli/configOption.test.ts`: Verify JSON config loading and override precedence.
   - `tests/unit/collector/PageCollectorSpa.test.ts`: Verify history retention during same-document routing.
2. **Quality Gates**:
   - `npm run typecheck`
   - `npm run test:unit`
   - `npm run check-format`
