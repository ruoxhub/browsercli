# Codebase Structure

**Analysis Date:** 2026-04-27

## Directory Layout

```
JSReverser-MCP/
├── src/                         # TypeScript source
│   ├── bin/                     # Package binary entry
│   ├── browser/                 # Browser launch/connect/session adapters
│   ├── cli/                     # CLI commands, output, config facade, tool metadata
│   │   └── commands/            # Individual js-reverse subcommands
│   ├── database/                # Drizzle schema and database exports
│   ├── formatters/              # Console/network/websocket formatting helpers
│   ├── modules/                 # Reusable reverse-engineering engines
│   │   ├── analyzer/            # AI/code analysis modules
│   │   ├── collector/           # Page/code/network/console collection modules
│   │   ├── crypto/              # Crypto detection rules and detectors
│   │   ├── debugger/            # Debugger managers and breakpoint helpers
│   │   ├── deobfuscator/        # AST/deobfuscation engines
│   │   ├── hook/                # Hook generation, storage, registry, manager
│   │   └── stealth/             # Anti-detection scripts and exports
│   ├── protocol/                # Sekiro WebSocket RPC client layer
│   ├── reverse/                 # Reverse task artifact store
│   ├── services/                # AI, LLM, database, site experience services
│   ├── third_party/             # Compatibility exports and vendor type shims
│   ├── tools/                   # Public tool handlers grouped by capability
│   ├── trace-processing/        # Trace parsing helpers
│   ├── types/                   # Shared project/CDP/platform types
│   ├── utils/                   # Shared logger/cache/errors/fs/path helpers
│   └── worker/                  # Tool adapter and runtime context provider
├── tests/                       # Node test runner suites
│   ├── bin/                     # CLI binary tests
│   ├── daemon/                  # Worker/daemon command tests
│   ├── integration/             # Integration tests
│   ├── manual/                  # Manual scripts
│   ├── performance/             # Performance tests
│   ├── property/                # fast-check/property tests
│   └── unit/                    # Unit tests mirroring src areas
├── docs/                        # User, guide, reference, and architecture docs
│   ├── guides/                  # Usage guides
│   ├── reference/               # Contracts, workflow templates, tool reference
│   └── superpowers/             # Design specs and plans
├── scripts/                     # Build, docs, verification, case, and lint scripts
│   ├── cases/                   # Public sanitized reverse cases
│   └── eslint_rules/            # Local ESLint rules
├── skills/                      # Project skill package for JS reverse workflow
├── .claude/skills/gitnexus/     # Project GitNexus skills
├── .planning/codebase/          # Generated codebase intelligence docs
├── artifacts/                   # Runtime task artifacts; private real task data not committed
├── build/                       # Generated build output
├── package.json                 # Package, scripts, deps, bin declarations
├── tsconfig.json                # TypeScript config
├── eslint.config.mjs            # ESLint flat config
└── .prettierrc.cjs              # Prettier config
```

## Directory Purposes

**`src/bin/`:**
- Purpose: Package executable entry points.
- Contains: CLI bootstrap files.
- Key files: `src/bin/js-reverse.ts`

**`src/cli/`:**
- Purpose: All user-facing CLI command logic and command support helpers.
- Contains: Command modules, output rendering, argument parsing, command help, tool metadata, validation, Worker process manager, Sekiro invoker.
- Key files: `src/cli/commands/start.ts`, `src/cli/commands/tool-dispatcher.ts`, `src/cli/worker-manager.ts`, `src/cli/sekiro-invoker.ts`, `src/cli/tools-meta.ts`, `src/cli/tool-arg-validator.ts`, `src/cli/index.ts`

**`src/worker/`:**
- Purpose: Runtime bridge between Sekiro Actions and pure tool handlers.
- Contains: Tool adapter, runtime context provider, response accumulator.
- Key files: `src/worker/ToolAdapter.ts`, `src/worker/ToolContextProvider.ts`, `src/worker/ToolResponseAccumulator.ts`

**`src/protocol/`:**
- Purpose: Sekiro WebSocket RPC implementation.
- Contains: Node client facade and lower-level WebSocket client.
- Key files: `src/protocol/Client.ts`, `src/protocol/sekiro.ts`

**`src/browser/`:**
- Purpose: Browser lifecycle, connection, session, and DevTools adapter management.
- Contains: `BrowserManager`, connect/launch helpers, stealth args, session manager, DevTools adapter.
- Key files: `src/browser/browser.ts`, `src/browser/index.ts`, `src/browser/SessionManager.ts`, `src/browser/DevToolsConnectionAdapter.ts`, `src/browser/stealth-args.ts`

**`src/tools/`:**
- Purpose: Public reverse-engineering tool handlers. Each subdirectory is a tool family exposed through `src/cli/tools-meta.ts`.
- Contains: 184 TypeScript tool files across analyzer, hook, debugger, network, page, navigation, workflow, and related capability groups.
- Key files: `src/tools/workflow/observeFlow.ts`, `src/tools/workflow/autoHook.ts`, `src/tools/workflow/rebuildBundle.ts`, `src/tools/debugger/index.ts`, `src/tools/network/listNetworkRequests.ts`, `src/tools/navigation/newPage.ts`

**`src/modules/`:**
- Purpose: Reusable implementation modules used by multiple tools and runtime services.
- Contains: Analyzer, collector, crypto, debugger, deobfuscator, hook, stealth, and browser alias modules.
- Key files: `src/modules/collector/CodeCollector.ts`, `src/modules/hook/HookManager.ts`, `src/modules/deobfuscator/Deobfuscator.ts`, `src/modules/debugger/DebuggerManager.ts`, `src/modules/crypto/CryptoDetector.ts`, `src/modules/stealth/StealthScripts2025.ts`

**`src/services/`:**
- Purpose: External provider and persistence service wrappers.
- Contains: AI service abstractions, OpenAI provider, LLM service, PostgreSQL service, site experience service.
- Key files: `src/services/AIService.ts`, `src/services/OpenAIProvider.ts`, `src/services/LLMService.ts`, `src/services/DatabaseService.ts`, `src/services/SiteExperienceService.ts`

**`src/database/`:**
- Purpose: Database schema and exports for Drizzle/PostgreSQL.
- Contains: Schema definitions and database barrel.
- Key files: `src/database/schema.ts`, `src/database/index.ts`

**`src/reverse/`:**
- Purpose: Reverse task artifact persistence.
- Contains: File-backed task store.
- Key files: `src/reverse/ReverseTaskStore.ts`

**`src/utils/`:**
- Purpose: Shared helpers used across CLI, tools, modules, and services.
- Contains: Logging, errors, config compatibility, filesystem safety, project paths, caches, pagination, mutex, keyboard, serializer, DevTools helpers.
- Key files: `src/utils/logger.ts`, `src/utils/fsSafe.ts`, `src/utils/projectPaths.ts`, `src/utils/DebuggerContext.ts`, `src/utils/UnifiedCacheManager.ts`, `src/utils/safeJson.ts`

**`src/types/`:**
- Purpose: Shared type definitions for platform, DevTools, Sekiro, and tool/domain contracts.
- Contains: Project-wide interfaces and `.d.ts` compatibility files.
- Key files: `src/types/index.ts`, `src/types/platform.ts`, `src/types/sekiro.ts`, `src/types/devtools.ts`, `src/types/chrome-devtools-frontend.d.ts`

**`src/third_party/`:**
- Purpose: Centralize compatibility imports and vendor-facing type shims.
- Contains: `patchright`/Puppeteer/Playwright compatibility exports and polyfills.
- Key files: `src/third_party/index.ts`, `src/third_party/puppeteer-compat.ts`, `src/third_party/playwright.ts`

**`src/formatters/`:**
- Purpose: Serialize collected console, network, and WebSocket data for output.
- Contains: Formatter functions.
- Key files: `src/formatters/consoleFormatter.ts`, `src/formatters/networkFormatter.ts`, `src/formatters/websocketFormatter.ts`

**`tests/`:**
- Purpose: Node built-in test suites and manual verification scripts.
- Contains: Unit, integration, property, performance, CLI, daemon, and manual tests.
- Key files: `tests/README.md`, `tests/setup.ts`, `tests/unit/worker/ToolAdapter.test.ts`, `tests/unit/worker/ToolContextProvider.test.ts`, `tests/integration/jshook-e2e.integration.test.ts`

**`docs/`:**
- Purpose: Project documentation, reference contracts, guides, and design records.
- Contains: Architecture docs, tool references, reverse workflow docs, case safety policy, generated plans/specs.
- Key files: `docs/Architecture.md`, `docs/reference/tool-io-contract.md`, `docs/reference/reverse-workflow.md`, `docs/guides/full-usage-guide.md`

**`scripts/`:**
- Purpose: Build/post-build, docs generation, verification, lint rule, and case scripts.
- Contains: TypeScript and JavaScript maintenance scripts, sanitized public case runners, local ESLint rules.
- Key files: `scripts/post-build.ts`, `scripts/generate-docs.ts`, `scripts/verify-all-tools.mjs`, `scripts/eslint_rules/local-plugin.js`, `scripts/cases/README.md`

**`skills/`:**
- Purpose: Project-specific reverse-engineering playbook for agent/tool workflows.
- Contains: `mcp-js-reverse-playbook` skill references, schemas, and case notes.
- Key files: `skills/mcp-js-reverse-playbook/SKILL.md`, `skills/mcp-js-reverse-playbook/references/tool-defaults.md`, `skills/mcp-js-reverse-playbook/references/task-artifacts.md`

**`.claude/skills/gitnexus/`:**
- Purpose: Local code-intelligence skill instructions.
- Contains: GitNexus workflow guides for exploring, impact analysis, debugging, refactoring, guide, and CLI.
- Key files: `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`, `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md`, `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`

## Key File Locations

**Entry Points:**
- `src/bin/js-reverse.ts`: Package CLI binary for `js-reverse`.
- `src/index.ts`: Worker process entry that connects browser runtime to Sekiro.
- `src/cli/index.ts`: Public barrel for CLI helpers, commands, and config exports.
- `src/browser/index.ts`: Public barrel for browser management helpers.

**Configuration:**
- `src/config.ts`: Central config chain, environment variable mapping, AI/browser config creation, config file helpers.
- `package.json`: Bin declarations, scripts, runtime dependencies, Node engine.
- `tsconfig.json`: TypeScript compiler options for `src/**/*.ts` and `tests/**/*.ts`.
- `eslint.config.mjs`: ESLint flat config.
- `.prettierrc.cjs`: Prettier formatting config.
- `config.json`: Root project config file. Describe keys only; do not copy sensitive values.
- `.env`: Local environment file present. Do not read or quote contents.
- `.env.example`: Example environment file. Use names only when documenting.

**Core Logic:**
- `src/cli/tools-meta.ts`: Tool registry and call mode definitions.
- `src/worker/ToolAdapter.ts`: Dynamic tool loading and Action wrapping.
- `src/worker/ToolContextProvider.ts`: Runtime service implementation for tools.
- `src/browser/browser.ts`: Browser launch/connect/page/stealth management.
- `src/protocol/Client.ts`: Node-level Sekiro Action registration.
- `src/protocol/sekiro.ts`: WebSocket reconnect, heartbeat, request dispatch.
- `src/utils/DebuggerContext.ts`: CDP debugger state and script/breakpoint tracking.
- `src/reverse/ReverseTaskStore.ts`: Task artifact persistence.

**Tool Families:**
- `src/tools/workflow/`: High-level workflows such as observe, auto-hook, rebuild.
- `src/tools/analyzer/`: Analysis, crypto detection, risk panel, reports, summaries.
- `src/tools/collector/`: Code collection, diffs, script search.
- `src/tools/debugger/`: Breakpoints, stepping, callframes, script source, paused state, XHR-to-JS tracing.
- `src/tools/hook/`: Browser/API/function hook tools and hook data access.
- `src/tools/network/`: Network request listing and detail retrieval.
- `src/tools/page/`: Page actions, session state, browser health.
- `src/tools/navigation/`: Page list/select/new/navigate functions.
- `src/tools/rebuild/`: Local reproduction and environment diff/export tools.

**Testing:**
- `tests/unit/`: Unit tests; mirror `src/` paths where possible.
- `tests/integration/`: Integration tests such as `tests/integration/jshook-e2e.integration.test.ts`.
- `tests/property/`: Property-based tests.
- `tests/performance/`: Performance tests.
- `tests/bin/`: CLI binary tests.
- `tests/daemon/`: Worker/daemon command tests.
- `tests/setup.ts` and `tests/setup.js`: Test runtime setup.

**Documentation and Contracts:**
- `docs/reference/tool-io-contract.md`: Canonical data-plane contract for tools and hook/artifact state.
- `docs/reference/reverse-workflow.md`: Reverse workflow reference.
- `docs/reference/reverse-artifacts.md`: Artifact conventions.
- `docs/Architecture.md`: Existing generated architecture reference.
- `.planning/codebase/ARCHITECTURE.md`: Generated architecture map for GSD planning.
- `.planning/codebase/STRUCTURE.md`: Generated structure map for GSD planning.

## Naming Conventions

**Files:**
- CLI command files use kebab-case or command-name files under `src/cli/commands/`, for example `src/cli/commands/list-tools.ts` and `src/cli/commands/tool-dispatcher.ts`.
- Tool handler files use camelCase or domain names matching exported handlers, for example `src/tools/navigation/newPage.ts`, `src/tools/network/listNetworkRequests.ts`, `src/tools/debugger/evaluateInPageRuntime.ts`.
- Module classes use PascalCase filenames, for example `src/modules/hook/HookManager.ts`, `src/modules/collector/CodeCollector.ts`, `src/browser/SessionManager.ts`.
- Type-only companion files are named `types.ts` inside the relevant family, for example `src/tools/network/types.ts` and `src/tools/analyzer/types.ts`.
- Public barrels use `index.ts`, for example `src/modules/hook/index.ts`, `src/services/index.ts`, `src/tools/collector/index.ts`.
- Tests use `*.test.ts` and integration tests use `*.integration.test.ts`, for example `tests/unit/worker/ToolAdapter.test.ts` and `tests/integration/jshook-e2e.integration.test.ts`.

**Directories:**
- Tool families are lowercase kebab-case or lowercase domain names under `src/tools/`, for example `anti-debug`, `code-templates`, `site-experience`, `script-injector`, `network`, `workflow`.
- Domain module directories are lowercase single responsibility names under `src/modules/`, for example `collector`, `debugger`, `deobfuscator`, `hook`.
- CLI command modules live only under `src/cli/commands/`.
- Generated build output belongs in `build/`; do not edit generated files there.

## Where to Add New Code

**New Public Tool:**
- Primary code: Add handler in `src/tools/<family>/<toolName>.ts`.
- Types: Add or extend `src/tools/<family>/types.ts` when runtime services, params, or result contracts are shared.
- Registry: Add a `ToolMeta` entry in `src/cli/tools-meta.ts` with `name`, `description`, `schema`, `modulePath`, `handlerName`, and `callMode`.
- Validation: Extend `src/cli/tool-arg-validator.ts` if schema-only coercion is insufficient.
- Tests: Add unit tests under `tests/unit/tools/<family>/<toolName>.test.ts` or the closest existing mirrored directory.

**New Tool Family:**
- Primary code: Create `src/tools/<family>/`.
- Exports: Add `src/tools/<family>/index.ts` when the family has multiple reusable exports.
- Runtime contracts: Create `src/tools/<family>/types.ts` for params/results/runtime interfaces.
- Registry: Add all public tools to `src/cli/tools-meta.ts`.
- Tests: Create matching tests under `tests/unit/tools/<family>/`.

**New Browser Runtime Capability:**
- Primary code: Add narrow service methods to `src/worker/ToolContextProvider.ts` only when tools need runtime state.
- Shared types: Put browser/platform contracts in `src/types/` or `src/tools/<family>/types.ts`.
- Browser ownership: Keep launch/connect/page ownership in `src/browser/browser.ts`; do not instantiate independent browsers in tool files.
- Tests: Add or extend `tests/unit/worker/ToolContextProvider.test.ts` and focused tool tests.

**New Reusable Reverse-Engineering Engine:**
- Primary code: Add classes/functions under `src/modules/<domain>/`.
- Public exports: Update `src/modules/<domain>/index.ts` when other areas need imports.
- Tool integration: Call the module from `src/tools/<family>/` or lazily from `src/worker/ToolContextProvider.ts`.
- Tests: Add unit tests under `tests/unit/modules/<domain>/`.

**New CLI Command:**
- Primary code: Add `src/cli/commands/<command>.ts`.
- Registration: Add it to the `commands` map in `src/bin/js-reverse.ts`.
- Public export: Re-export from `src/cli/index.ts` when reusable.
- Help: Update `src/cli/help.ts`.
- Tests: Add CLI tests under `tests/bin/` or `tests/unit/cli/`.

**New Configuration Key:**
- Primary code: Add the type field and environment mapping in `src/config.ts`.
- CLI command: Update `src/cli/commands/config.ts` if the key should be visible/editable from CLI.
- Documentation: Mention key names only; never include secret values.
- Tests: Add config tests under `tests/unit/` matching existing config test locations.

**New Persistence Feature:**
- Database schema: Add schema changes in `src/database/schema.ts`.
- Service logic: Add service methods in `src/services/<Service>.ts` or extend `src/services/DatabaseService.ts` only for connection/lifecycle behavior.
- Artifact logic: Use `src/reverse/ReverseTaskStore.ts` for file-backed task evidence and snapshots.
- Tests: Add unit service tests and integration tests when PostgreSQL behavior is required.

**New Documentation or Contract:**
- User guide: Add to `docs/guides/`.
- Technical contract/reference: Add to `docs/reference/`.
- GSD-generated codebase intelligence: Add to `.planning/codebase/`.
- Skill/playbook reference: Add to `skills/mcp-js-reverse-playbook/references/` when it guides agent/tool workflows.

**Utilities:**
- Shared helpers: Add to `src/utils/` only when used across multiple layers.
- Domain-specific helpers: Keep them near the tool or module family, for example `src/tools/shared/activePageResolver.ts` for tool-specific shared behavior.
- Avoid new generic utilities for one caller.

## Special Directories

**`build/`:**
- Purpose: Generated JavaScript output from SWC and post-build processing.
- Generated: Yes.
- Committed: Package files may include build output, but source edits should be made in `src/`, not `build/`.

**`artifacts/`:**
- Purpose: Runtime reverse-task evidence and generated bundles under `artifacts/tasks/<task-id>/`.
- Generated: Yes.
- Committed: Template/safe structure only. Do not commit private task data, cookies, storage, credentials, production URLs, or session state.

**`.planning/codebase/`:**
- Purpose: GSD codebase intelligence documents consumed by planning/execution commands.
- Generated: Yes.
- Committed: Yes when planning docs are intended to persist.

**`.claude/skills/gitnexus/`:**
- Purpose: Project-local GitNexus usage instructions.
- Generated: No.
- Committed: Yes.

**`skills/mcp-js-reverse-playbook/`:**
- Purpose: Project workflow skill and references for JS reverse tasks.
- Generated: No.
- Committed: Yes.

**`debugger-sessions/`:**
- Purpose: Local debugger/session output.
- Generated: Yes.
- Committed: Treat as runtime output unless explicitly sanitized.

**`.gitnexus/`:**
- Purpose: GitNexus index and code-intelligence data.
- Generated: Yes.
- Committed: Project-dependent; refresh with `npx gitnexus analyze` when stale.

**`node_modules/`:**
- Purpose: Installed dependencies.
- Generated: Yes.
- Committed: No.

**`.env` and `.env.*`:**
- Purpose: Local environment configuration and secrets.
- Generated: User/local.
- Committed: No for secrets. Never read, quote, or copy values.

---

*Structure analysis: 2026-04-27*
