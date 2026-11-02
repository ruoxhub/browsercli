# Align Lifecycle Commands with chrome-devtools (`start`, `stop`, `status`) and Retire Legacy Commands

The CLI initially exposed disjoint commands for daemon process lifecycle and browser lifecycle: `open` (spawn or probe daemon), `close` (stop daemon), `list` (enumerate sessions), `kill-all` (force kill all daemons), and `browser` (`browser connect|disconnect|status`). This dual-model design introduced unnecessary cognitive overhead, divergence from developer tooling standards like `@open-source/chrome-devtools-mcp`, and redundant subcommands.

We decided to align `browsercli` completely with `chrome-devtools`'s core lifecycle command model:
- `browsercli start`: Start or restart the daemon session. Supports directly forwarding browser connection parameters (`--browser-url`, `--ws-endpoint`, `--channel`, `--headless`, `--cloak`, etc.) so daemon startup and browser initialization can be completed in a single command.
- `browsercli stop`: Stop the current daemon session. Accepts `--all` to stop/kill all running daemon processes and clean registry state (replacing `kill-all`).
- `browsercli status`: Check daemon session and browser connection status. Displays the active session state, process ID, socket/console ports, and browser connection details, as well as an overview of other running sessions in the workspace/registry.

Legacy commands (`open`, `close`, `list`, `kill-all`, and `browser`) are removed from top-level help and documentation, while retaining friendly redirect hints with error code `COMMAND_DEPRECATED` for backward compatibility.

## Consequences

- Consistent ergonomics: Users interact with three simple, intuitive commands (`start`, `stop`, `status`) matching the convention in `chrome-devtools`.
- Single-turn browser setup: Users no longer need to run `open` followed by `browser connect`; `browsercli start --channel chrome` handles the entire lifecycle seamlessly.
- Smooth migration: Anyone typing `browsercli open`, `close`, `list`, `kill-all`, or `browser` receives immediate guidance directing them to the new command.
- Streamlined CLI interface: Help text, tab completion, and documentation are significantly cleaner and focused on core reverse-engineering workflows.
