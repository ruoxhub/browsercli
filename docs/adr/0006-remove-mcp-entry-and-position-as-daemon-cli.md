# Remove the MCP stdio Entry Point; Position the Repository as a Daemon + CLI Tool Set

The repository originally shipped two transports for the same tool surface: an MCP stdio server (`McpContext`, `McpResponse`, `src/bin/*`, `@modelcontextprotocol/sdk`) and a local daemon. Commit `ee50f69f` deleted the MCP server implementation and its SDK dependency, and `696d6827` subsequently removed the remaining `/api/v1` HTTP contract and the Web console. Since then `src/index.ts` has had exactly one entry point, `runDaemon()`, and the only way to reach a tool is the `browsercli` CLI over a local named-pipe/unix-socket `tool.invoke` request. Documentation, however, continued to describe the repository as an "MCP service", kept the `mcpName` package field, and shipped guides instructing users to configure `mcpServers` JSON blocks and `--http --port` flags that no process reads.

We decided to make the removal explicit and final: delete the `mcpName` field, delete the `bundle` and `verify-server-json-version` npm scripts together with the Rollup toolchain they referenced, delete the guides that documented the retired transports, and describe the project in the README and guides as a daemon + CLI tool set. The tool surface itself is unchanged — 114 tools, invoked as `browsercli call <tool_name>`.

## Consequences

- There is one documented transport. `src/index.ts` starts a daemon; `browsercli` discovers or spawns that daemon by workspace hash and sends `tool.invoke` over a local socket. No reader is told to configure an MCP client or an HTTP port.
- Guides describing the MCP transport (`http-mode.md`, `client-configuration.md`) are deleted rather than annotated, because they were instructions that could not work, not merely stale descriptions. `getting-started.md` and `troubleshooting.md` are rewritten against the real CLI surface.
- Package metadata no longer advertises an MCP server name, and the `main` field points at the real build output instead of a root `index.js` that never existed.
- Restoring an MCP transport later is a new feature requiring a new ADR, not a documentation fix. The tool definitions, registry, and `ToolExecutionPipeline` remain transport-agnostic, so the tool layer itself needs no change to support one.
- `docs/reference/tool-reference.md` is generated from the registry and is now guarded by a test that fails when the documented tool set diverges from the registered one, preventing the drift that let this documentation gap persist unnoticed.
