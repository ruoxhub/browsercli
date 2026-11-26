---
status: accepted
---

# Enforce Declarative Response Materialization and Separate Formatters from Tool Handlers

Although `browsercli` retired its MCP stdio transport in favor of a Daemon + CLI model (ADR-0006), `ToolResponseAccumulator` kept an incomplete copy of the MCP `Response` interface with 5 `// no-op for worker mode` stubs (`attachImage`, `attachNetworkRequest`, `attachConsoleMessage`, `setIncludeConsoleData`, `setListExtensions`). As a result, tool handlers manually assembled `structuredContent` JSON, duplicated pagination and truncation logic, and relied on ad-hoc post-processing stuffed into `ToolExecutionRouter.enrichAccumulator`, causing domain tool files to bloat up to 3,621 lines while `src/formatters/` contained only two files.

Rather than deleting the declarative response interface and letting handlers return raw JSON, we decided to complete `DeclarativeResponse` materialization inside a dedicated `ToolResponse.materialize(context, page)` stage backed by domain formatters under `src/formatters/` (`DebuggerFormatter`, `HookFormatter`, `NetworkFormatter`, `WasmFormatter`, `SnapshotFormatter`, etc.). Handlers record output intent only; materialization fetches referenced records, applies pagination/token-budget truncation, captures optional snapshots/console errors/wait results, and emits both machine-readable `structuredContent` (consumed by CLI and scripts) and concise Agent-readable text lines.

## Consequences

- Tool files under `src/tools/` shrink into thin schema-plus-delegation adapters, cleanly separated from domain logic (`src/modules/`) and output presentation (`src/formatters/`).
- All 5 previously dead `Response` methods become real declarative capabilities, and `ToolExecutionRouter.enrichAccumulator` is removed.
- Formatting rules, pagination envelopes, and truncation limits are enforced consistently across all 104 tools in one place instead of drifting per handler.
