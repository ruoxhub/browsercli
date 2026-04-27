# Architecture

**Analysis Date:** 2026-04-27

## Pattern Overview

**Overall:** CLI-managed Worker + Sekiro WebSocket RPC + functional tool modules over a shared browser runtime.

**Key Characteristics:**
- The user-facing command entry is `src/bin/js-reverse.ts`; it builds an `axi-sdk-js` CLI and delegates commands to `src/cli/commands/*.ts`.
- Long-lived work runs in the Worker entry `src/index.ts`, which initializes configuration, browser state, runtime services, Sekiro connectivity, tool registration, and shutdown.
- Tools are registered from metadata in `src/cli/tools-meta.ts`, dynamically loaded by `src/worker/ToolAdapter.ts`, and executed as Sekiro Actions through `src/protocol/Client.ts`.
- Browser automation uses `patchright` through `src/browser/browser.ts`; runtime state for selected page/frame, network storage, debugger contexts, and module services is centralized in `src/worker/ToolContextProvider.ts`.
- Reverse-engineering capabilities follow the project method: observe first, hook next, breakpoint last, and persist evidence in `artifacts/tasks/<task-id>/`.
- GitNexus project skills are present under `.claude/skills/gitnexus/`; use GitNexus for architecture exploration and impact analysis when navigating or changing symbols.

## Layers

**CLI Layer:**
- Purpose: Parse user commands, resolve configuration, start/stop Worker processes, invoke remote tools, and present CLI output.
- Location: `src/bin/js-reverse.ts`, `src/cli/`, `src/cli/commands/`
- Contains: `axi-sdk-js` command definitions, argument parsing, command help, tool metadata search, worker lifecycle commands, REPL, config commands.
- Depends on: `src/config.ts`, `src/cli/worker-manager.ts`, `src/cli/sekiro-invoker.ts`, `src/cli/tools-meta.ts`
- Used by: The package binary `js-reverse` declared in `package.json`.

**Worker Runtime Layer:**
- Purpose: Own the long-lived process that connects to Sekiro, owns browser/runtime context, registers tools, and handles graceful shutdown.
- Location: `src/index.ts`, `src/worker/`
- Contains: Worker bootstrap, `ToolAdapter`, `ToolContextProvider`, `ToolResponseAccumulator`.
- Depends on: `src/browser/index.ts`, `src/protocol/Client.ts`, `src/services/DatabaseService.ts`, `src/config.ts`, `src/cli/tools-meta.ts`
- Used by: `src/cli/worker-manager.ts` when spawning `build/src/index.js`.

**RPC / Protocol Layer:**
- Purpose: Connect the Worker to a Sekiro server and expose each tool as an Action.
- Location: `src/protocol/Client.ts`, `src/protocol/sekiro.ts`, `src/types/sekiro.ts`
- Contains: `NodeClient`, `SekiroClient`, request/response/action types, reconnect and heartbeat handling.
- Depends on: `ws`, `src/types/platform.ts`, `src/types/sekiro.ts`
- Used by: `src/index.ts`, `src/cli/sekiro-invoker.ts`, `src/cli/commands/tool-dispatcher.ts`

**Tool Registry Layer:**
- Purpose: Define the public tool catalog and map tool names to modules, handler names, schemas, and invocation modes.
- Location: `src/cli/tools-meta.ts`, `src/cli/converted-skill-tools.ts`, `src/cli/tool-arg-validator.ts`
- Contains: `TOOLS_META`, call modes (`runtime`, `frame`, `params-only`), schemas, skill compatibility mappings, argument validation.
- Depends on: Tool modules under `src/tools/**`
- Used by: `src/worker/ToolAdapter.ts`, `src/cli/commands/list-tools.ts`, `src/cli/commands/tool-dispatcher.ts`, built-in Worker actions in `src/index.ts`.

**Tool Implementation Layer:**
- Purpose: Implement user-facing reverse-engineering actions as focused functions.
- Location: `src/tools/`
- Contains: Tool families for workflow, navigation, page, network, debugger, hook, crypto, collector, analyzer, DOM, screenshot, script injection, stealth, WebSocket, Vue, and site experience.
- Depends on: Runtime service interfaces from sibling `types.ts` files, `src/worker/ToolContextProvider.ts` implementations, `src/modules/**`, `src/utils/**`
- Used by: `src/worker/ToolAdapter.ts` through dynamic imports configured in `src/cli/tools-meta.ts`.

**Domain Modules Layer:**
- Purpose: Provide reusable engines behind tools.
- Location: `src/modules/`
- Contains: Analyzer (`src/modules/analyzer/`), collector (`src/modules/collector/`), crypto (`src/modules/crypto/`), debugger (`src/modules/debugger/`), deobfuscator (`src/modules/deobfuscator/`), hook (`src/modules/hook/`), stealth (`src/modules/stealth/`), browser alias (`src/modules/browser/BrowserModeManager.ts`).
- Depends on: `src/third_party/`, `src/utils/`, `src/services/`, Babel packages, CDP types, browser/runtime abstractions.
- Used by: `src/worker/ToolContextProvider.ts` and tools under `src/tools/**`.

**Browser / CDP Layer:**
- Purpose: Launch, connect, manage, and recover browser sessions and CDP debugger contexts.
- Location: `src/browser/`, `src/utils/DebuggerContext.ts`, `src/tools/debugger/`
- Contains: `BrowserManager`, auto-connect logic, launch args, stealth injection, current-page tracking, CDP debugger state, script and breakpoint tracking.
- Depends on: `patchright`, `node:fs`, `node:net`, `node:os`, `node:path`, `src/modules/stealth/index.ts`
- Used by: Worker startup in `src/index.ts`, runtime service methods in `src/worker/ToolContextProvider.ts`, browser health/navigation/page/debugger tools.

**Services / Persistence Layer:**
- Purpose: Encapsulate external AI, optional PostgreSQL persistence, site experience storage, and task artifacts.
- Location: `src/services/`, `src/database/`, `src/reverse/`
- Contains: `AIService`, `LLMService`, `OpenAIProvider`, `DatabaseService`, Drizzle schema, `SiteExperienceService`, `ReverseTaskStore`.
- Depends on: `openai`, `drizzle-orm`, `pg`, `src/config.ts`, `src/utils/projectPaths.ts`
- Used by: Analyzer tools, site-experience tools, optional Worker database initialization, evidence/report/bundle flows.

**Utilities / Shared Types Layer:**
- Purpose: Provide shared error, logging, cache, serialization, filesystem safety, pagination, mutex, keyboard, and path helpers.
- Location: `src/utils/`, `src/types/`, `src/third_party/`, `src/formatters/`
- Contains: `logger`, `fsSafe`, `safeJson`, `UnifiedCacheManager`, `AdaptiveDataSerializer`, platform/devtools/tool types, formatter helpers, third-party compatibility exports.
- Depends on: Standard Node APIs and project config.
- Used by: Almost every layer; add shared helpers here only when used across tool families or modules.

## Data Flow

**CLI Tool Invocation:**

1. User runs `js-reverse call <tool>` through `src/bin/js-reverse.ts`.
2. `src/cli/commands/tool-dispatcher.ts` parses CLI flags, resolves legacy skill aliases from `src/cli/converted-skill-tools.ts`, validates args through `src/cli/tool-arg-validator.ts`, then invokes `src/cli/sekiro-invoker.ts`.
3. Sekiro routes the Action request to the Worker group configured by `src/config.ts`.
4. `src/protocol/Client.ts` receives the request through `SekiroClient` from `src/protocol/sekiro.ts`.
5. `src/worker/ToolAdapter.ts` loads the handler from `src/tools/**` using `modulePath` and `handlerName` in `src/cli/tools-meta.ts`.
6. `ToolAdapter.wrapTool()` selects call shape by `callMode`: runtime service object, selected frame, or params only.
7. The tool returns a structured result that `src/worker/ToolResponseAccumulator.ts` converts to the JSON response returned to the CLI.

**Worker Startup:**

1. `src/cli/commands/start.ts` delegates Worker process creation to `src/cli/worker-manager.ts`.
2. `WorkerManager.start()` spawns `build/src/index.js`, writes a PID file under the OS temp directory, and waits for the ready marker.
3. `src/index.ts` parses Worker args, calls `resolveConfig()` from `src/config.ts`, optionally connects `src/services/DatabaseService.ts`, and creates `ToolContextProvider`.
4. `src/browser/browser.ts` `BrowserManager.getInstance()` connects to an existing browser or launches a new one through `patchright`.
5. The Worker creates a page, stores browser/context/page state in `ToolContextProvider`, registers built-in `_list_tools`, `_list_skills`, and `_status`, then registers all tools from `src/cli/tools-meta.ts`.
6. `NodeClient.start()` connects to Sekiro and re-registers Actions after reconnects.

**Observe Hook Debug Rebuild Workflow:**

1. Observation starts with workflow/analyzer/collector tools such as `src/tools/workflow/observeFlow.ts`, `src/tools/collector/collectCode.ts`, and `src/tools/analyzer/analyzeTarget.ts`.
2. Code and page data are collected from browser runtime services and module collectors in `src/modules/collector/`.
3. Hook plans are generated and injected through `src/tools/workflow/autoHook.ts`, `src/tools/hook/**`, and `src/modules/hook/**`.
4. Debugger escalation uses `src/tools/debugger/index.ts` and `src/utils/DebuggerContext.ts` to track scripts, breakpoints, execution contexts, paused state, and XHR breakpoints.
5. Evidence is reported through analyzer report helpers in `src/tools/analyzer/reports.ts` and persisted with `src/reverse/ReverseTaskStore.ts`.
6. Local reproduction bundles are generated by `src/tools/workflow/rebuildBundle.ts` and `src/tools/rebuild/**`, using artifacts and captured runtime evidence.

**State Management:**
- Browser state: `BrowserManager` in `src/browser/browser.ts` owns browser/context/current page and crash/restart behavior.
- Tool runtime state: `ToolContextProvider` in `src/worker/ToolContextProvider.ts` owns selected page/frame, page list, debugger context/session maps, network request storage, and lazy module/service instances.
- Page-side hook state: `window.__hookStore[hookId]` is the canonical data store for hook records, with metadata in `window.__mcp_hooks__` and monitor metadata in `window.__mcp_monitors__`; see `docs/reference/tool-io-contract.md`.
- Server-side hook summaries: Use hook manager data paths from `src/modules/hook/HookManager.ts`; analyzer/report tools should read via known hook IDs rather than separate page-side keys.
- Task artifacts: `src/reverse/ReverseTaskStore.ts` writes `task.json`, `timeline.jsonl`, named JSONL logs, and snapshots under `artifacts/tasks/<task-id>/`.
- Optional persistence: `src/services/DatabaseService.ts` manages PostgreSQL state for site experience records using schema in `src/database/schema.ts`.

## Key Abstractions

**ToolMeta:**
- Purpose: Public contract for tool name, description, schema, module path, handler export, and call mode.
- Examples: `src/cli/tools-meta.ts`, `src/cli/tool-arg-validator.ts`
- Pattern: Central registry; add a new public tool by adding metadata and pointing to a function in `src/tools/<family>/<tool>.ts`.

**ToolAdapter:**
- Purpose: Convert internal tool functions into Sekiro `ActionHandler` callbacks.
- Examples: `src/worker/ToolAdapter.ts`, `src/worker/ToolResponseAccumulator.ts`
- Pattern: Dynamic import plus call-mode adapter. Keep tool functions focused; put runtime bridging in `ToolAdapter` or `ToolContextProvider`.

**ToolContextProvider:**
- Purpose: Implement runtime service interfaces required by tool families.
- Examples: `src/worker/ToolContextProvider.ts`, `src/tools/network/types.ts`, `src/tools/navigation/types.ts`
- Pattern: State and service bridge. Tools should depend on narrow runtime interfaces instead of importing global browser state directly.

**BrowserManager:**
- Purpose: Singleton manager for browser connection/launch/page state and stealth setup.
- Examples: `src/browser/browser.ts`, `src/browser/index.ts`, `src/modules/browser/BrowserModeManager.ts`
- Pattern: Use `BrowserManager.getInstance(config)` for Worker-level browser ownership; do not create independent browser managers inside tools.

**NodeClient / SekiroClient:**
- Purpose: Register Actions, connect to Sekiro, handle reconnects and heartbeat.
- Examples: `src/protocol/Client.ts`, `src/protocol/sekiro.ts`
- Pattern: `NodeClient` owns project-level Action registration; `SekiroClient` owns WebSocket mechanics.

**Runtime Service Interfaces:**
- Purpose: Decouple tools from the concrete Worker context.
- Examples: `src/tools/network/types.ts`, `src/tools/navigation/types.ts`, `src/tools/analyzer/types.ts`, `src/tools/page/types.ts`
- Pattern: Tool files accept `runtime` plus typed params; tests can provide minimal fakes.

**Domain Engines:**
- Purpose: Reusable analyzers, collectors, hook managers, deobfuscators, crypto detectors, and debugger managers.
- Examples: `src/modules/collector/CodeCollector.ts`, `src/modules/hook/HookManager.ts`, `src/modules/deobfuscator/Deobfuscator.ts`, `src/modules/crypto/CryptoDetector.ts`, `src/modules/debugger/DebuggerManager.ts`
- Pattern: Put capability logic in `src/modules/**` when more than one tool or workflow needs it.

**ReverseTaskStore:**
- Purpose: Persist reverse-task descriptors, timeline events, logs, and snapshots as file artifacts.
- Examples: `src/reverse/ReverseTaskStore.ts`, `docs/reference/reverse-artifacts.md`
- Pattern: Use task artifacts for evidence, not ad hoc files outside `artifacts/tasks/<task-id>/`.

**Configuration Chain:**
- Purpose: Merge CLI args, environment variables, root/project/user JSON config, and defaults.
- Examples: `src/config.ts`, `src/cli/commands/config.ts`
- Pattern: Use `resolveConfig()` for Worker/CLI operational config and `getEnvValue()` / `getEnvBoolean()` for specialized runtime flags.

## Entry Points

**Package CLI:**
- Location: `src/bin/js-reverse.ts`
- Triggers: `js-reverse` binary from `package.json`
- Responsibilities: Register CLI commands, resolve `WorkerContext`, create `SekiroInvoker` and `WorkerManager`, display command help.

**Worker Process:**
- Location: `src/index.ts`
- Triggers: Spawned by `src/cli/worker-manager.ts` or run directly through `node build/src/index.js`
- Responsibilities: Resolve config, connect optional database, initialize browser/runtime, register tools as Actions, connect to Sekiro, handle graceful shutdown.

**CLI Public Barrel:**
- Location: `src/cli/index.ts`
- Triggers: Imports from tests, scripts, or consumers that need CLI helpers.
- Responsibilities: Re-export CLI commands, config helpers, types, output helpers, `SekiroInvoker`, and `WorkerManager`.

**Legacy / MCP-style CLI Options Parser:**
- Location: `src/cli.ts`
- Triggers: Direct imports where yargs-style browser/server options are needed.
- Responsibilities: Define browser/http/session/database command-line options and parse arguments.

**Browser Public Barrel:**
- Location: `src/browser/index.ts`
- Triggers: Worker startup and module imports.
- Responsibilities: Re-export browser connection helpers, `BrowserManager`, `SessionManager`, DevTools adapter, and launch arg constants.

**Tool Registry:**
- Location: `src/cli/tools-meta.ts`
- Triggers: Worker tool registration, CLI list/search/call commands, built-in `_list_tools`.
- Responsibilities: Define available tools and how to load each handler.

**Database Schema:**
- Location: `src/database/schema.ts`
- Triggers: Drizzle service usage in `src/services/DatabaseService.ts` and `src/services/SiteExperienceService.ts`.
- Responsibilities: Define site experience persistence schema.

## Error Handling

**Strategy:** Return structured tool errors at the tool boundary, throw typed CLI errors at the command boundary, and log operational failures in long-lived services.

**Patterns:**
- CLI commands throw `AxiError` from `src/cli/errors.ts` or imported `axi-sdk-js` for validation, unknown tools, unavailable Worker, and invocation errors.
- Tool functions usually return `{success: false, message/error, tooltype, logFormat?, data?}` rather than throwing across RPC; see `src/tools/navigation/newPage.ts` and `src/tools/network/listNetworkRequests.ts`.
- `src/worker/ToolAdapter.ts` catches handler exceptions, logs duration/status, and rejects the Sekiro Action with a message.
- `src/index.ts` catches startup failures and exits with code `1`; graceful shutdown attempts browser and database cleanup independently.
- `src/protocol/sekiro.ts` handles WebSocket disconnects with reconnect scheduling and maintains explicit connection states.
- Browser and debugger cleanup paths intentionally ignore already-closed page/session errors in `src/worker/ToolContextProvider.ts` and `src/utils/DebuggerContext.ts`.

## Cross-Cutting Concerns

**Logging:** Use `src/utils/logger.ts` for module logging and controlled levels from `LOG_LEVEL`. CLI/Worker startup currently also uses `console.log` in `src/index.ts`, `src/worker/ToolAdapter.ts`, `src/protocol/Client.ts`, and `src/protocol/sekiro.ts`.

**Validation:** CLI tool args are validated in `src/cli/tool-arg-validator.ts` against schemas in `src/cli/tools-meta.ts`. Runtime tools validate required params locally, for example `url` in `src/tools/workflow/observeFlow.ts` and browser/page availability in `src/worker/ToolAdapter.ts`.

**Authentication:** The project has no application user-auth layer. External access and secrets are configured by environment/config names in `src/config.ts`, including `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `DATABASE_URL`, `SEKIRO_HOST`, and browser connection settings. Never write secret values into codebase docs or artifacts.

**Configuration:** Use `src/config.ts` for config resolution. The documented precedence is CLI args, env vars, root `config.json`, project `js-reverse.config.json`, user `~/.jsreverserrc.json`, defaults.

**Filesystem Safety:** Use helpers in `src/utils/fsSafe.ts` and `src/utils/projectPaths.ts` for output and artifact paths. Respect `JSREVERSER_OUTPUT_DIR` and task artifact conventions.

**Testing Surface:** Tests live under `tests/unit/`, `tests/integration/`, `tests/property/`, `tests/performance/`, `tests/bin/`, and `tests/daemon/`. Mirror source paths where practical; Worker and tool adapter behavior is covered under `tests/unit/worker/`.

**Project Skills:** `.claude/skills/gitnexus/` defines mandatory code-intelligence workflows for exploration, impact analysis, debugging, refactoring, and GitNexus CLI maintenance. Use `gitnexus://repo/JSReverser-MCP/context` and `gitnexus_query`/`gitnexus_context` for unfamiliar architecture areas.

---

*Architecture analysis: 2026-04-27*
