---
status: accepted
---

# Adopt a Two-Tier Aggregate Root (`SessionContext` & `BrowserPage`) and Retire Global `Runtime`

Following the removal of the legacy MCP transport (ADR-0006), `browsercli` retained a fragmented state model split across `getRuntime()` (a mutable global singleton called directly by 8 tool files 38 times), `ToolContextProvider`, `ServiceLocator`, `DefineToolContextFactory`, 9 parallel per-page `WeakMap`/collector tables across three context providers, and module-level singletons (`globalPageSnapshotManager`, `globalPageHealthTracker`, `workerActivityCoordinator`). Switching tabs or reconnecting required imperative pointer synchronization (`syncPageContext`, `onContextReplaced`) and made multi-page concurrency fragile.

We decided to consolidate all browser and page state into a two-tier aggregate root modeled after `chrome-devtools-mcp`:
- **`SessionContext`** owns browser-level concerns and cross-page assets: browser connection lifecycle, isolated contexts, stable `pageId` allocation, concurrency scheduling, stateless/cross-page hook infrastructure (`HookTypeRegistry`, `PersistentHookRegistry` keyed by `BrowserContext` so persistent hooks survive parent tab closure across popups/navigations), shared script asset caches (`CollectedFileRegistry`, `CodeCache`), and offline/cross-page reverse-engineering services (`WasmAnalyzer`, `WasmDecompiler`, `WasmRuntimeInspector`, `SourceMapService`, `VideoManager`, `ArtifactStorage`).
- **`BrowserPage`** owns all single-page runtime state and page-bound capture channels (`DebuggerManager`, `LogpointManager`, `NetworkMockManager`, emulation, per-page `PageHookStore`, page-bound `CdpNetworkMonitor`/`PageScriptCollector`, `WasmCollector`, network/console/WS collectors, snapshot, health) with unified disposal on page close.
- Global `getRuntime()`, `ServiceLocator`, `DefineToolContextFactory`, and hidden `BrowserManager.getInstance()` / `UnifiedCacheManager.getInstance()` backdoors are retired. Tool definitions split into compile-time scopes (`definePageTool` / `defineBrowserTool` / `defineStatelessTool`), where `definePageTool` uniformly injects an optional `pageId` parameter (defaulting to `selectedPage` for backward compatibility) and routes execution onto that page's dedicated concurrency queue. `scripts/check-arch.ts` will enforce a hard ban on `src/tools/` importing runtime singletons directly.

## Consequences

- Every stateful service has one explicit lifecycle owner (`BrowserPage` or `SessionContext`), eliminating hidden global state and tab-switching races while preserving cross-page `PersistentHook` survival and cross-page script deduplication/lookup.
- Page-scoped tool handlers receive a non-null `BrowserPage` at compile time and can execute concurrently across different tabs via explicit `pageId` routing without fighting over global `selectedPage`.
- Existing tests that stub `setRuntime()` will migrate to injecting a fake `SessionContext` or `BrowserPage` directly.
- Migration proceeds incrementally across four phases while keeping all 104 external CLI tool names and parameter contracts backward compatible.
