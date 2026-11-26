---
status: accepted
---

# Use a Static Daemon Tool Registry with a Build-Time JSON Manifest for CLI

`browsercli` previously relied on a three-stage indirection chain to discover and run tools: a regex script (`scripts/generate-tools-index.ts`) extracted `manifest` blocks into `generated-tools-index.ts`, `tools-meta.ts` dynamically `import()`ed every tool module to introspect Zod schemas at runtime, and `ToolHandlerLoader` dynamically `import()`ed the handler again during dispatch alongside dead legacy `callMode` branches. This complexity existed because the CLI needed tool metadata for help and flag parsing without paying the cold-start cost of importing Patchright, Babel, or Wabt.

We decided to split registration by execution surface instead of sharing a dynamic loader:
- **Daemon side** imports all tool definitions statically from a single index module (matching `chrome-devtools-mcp/src/tools/tools.ts`), removing `ToolHandlerLoader`, `ToolExecutionRouter`, and dead `callMode` branches in favor of a single straight-line `ToolExecutor`.
- **CLI side** reads a pure static `tools-manifest.json` emitted during `npm run build` (containing canonical names, aliases, descriptions, and argument specs), eliminating all runtime module reflection on CLI startup.

## Consequences

- CLI commands (`browsercli list-tools`, `--help`, flag parsing and disambiguation) stay fast with zero dependency on browser or reverse-engineering libraries.
- Daemon startup catches missing or mismatched tool exports at TypeScript compile time rather than failing dynamically at first invocation.
- Adding or renaming a tool still requires running `npm run build` (or the manifest generator) to refresh `tools-manifest.json`; the existing contract test suite will verify that the generated JSON matches the static daemon tool list.
